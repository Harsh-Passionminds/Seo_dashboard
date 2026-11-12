import { google } from "googleapis";
import { pool } from "../db/pool.js";
import { getAuthorizedGoogleClient } from "./google-oauth.service.js";
import { HttpError } from "../utils/http-error.js";
import { assertDateRange } from "../utils/dates.js";

export function normalizeKeyword(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export async function listTrackedKeywords(websiteId) {
  const [rows] = await pool.execute(
    `SELECT keyword_id, website_id, keyword, created_at, updated_at
     FROM tracked_keywords WHERE website_id = ? ORDER BY keyword ASC`,
    [websiteId]
  );
  return rows;
}

export async function addTrackedKeyword(websiteId, keyword) {
  const clean = String(keyword || "").trim().replace(/\s+/g, " ");
  if (!clean || clean.length > 500) {
    throw new HttpError(400, "Keyword must contain 1 to 500 characters.", "INVALID_KEYWORD");
  }
  const normalized = normalizeKeyword(clean);
  try {
    const [result] = await pool.execute(
      `INSERT INTO tracked_keywords (website_id, keyword, keyword_normalized)
       VALUES (?, ?, ?)`,
      [websiteId, clean, normalized]
    );
    const [rows] = await pool.execute(
      `SELECT keyword_id, website_id, keyword, created_at, updated_at
       FROM tracked_keywords WHERE keyword_id = ? AND website_id = ?`,
      [result.insertId, websiteId]
    );
    return rows[0];
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw new HttpError(409, "This keyword is already tracked for the website.", "KEYWORD_ALREADY_EXISTS");
    }
    throw error;
  }
}

export async function deleteTrackedKeyword(websiteId, keywordId) {
  const [result] = await pool.execute(
    "DELETE FROM tracked_keywords WHERE website_id = ? AND keyword_id = ?",
    [websiteId, keywordId]
  );
  if (!result.affectedRows) {
    throw new HttpError(404, "Tracked keyword not found.", "KEYWORD_NOT_FOUND");
  }
}

export async function getKeywordHistory(websiteId, keywordId, startDate, endDate) {
  const range = assertDateRange(startDate, endDate);
  const [keywords] = await pool.execute(
    "SELECT keyword_id FROM tracked_keywords WHERE website_id = ? AND keyword_id = ? LIMIT 1",
    [websiteId, keywordId]
  );
  if (!keywords.length) {
    throw new HttpError(404, "Tracked keyword not found.", "KEYWORD_NOT_FOUND");
  }
  const [rows] = await pool.execute(
    `SELECT report_date, clicks, impressions, ctr, average_position
     FROM gsc_keyword_history
     WHERE website_id = ? AND keyword_id = ? AND report_date BETWEEN ? AND ?
     ORDER BY report_date ASC`,
    [websiteId, keywordId, range.startDate, range.endDate]
  );
  return rows.map((row) => ({
    ...row,
    report_date: String(row.report_date).slice(0, 10)
  }));
}

export async function syncGscKeywordsRange({ userId, website, startDate, endDate, keywordId = null }) {
  if (!website.gsc_property_url) {
    throw Object.assign(new Error("This website has no GSC property URL configured."), {
      status: 400, code: "GSC_PROPERTY_MISSING"
    });
  }
  const [keywords] = keywordId
    ? await pool.execute(
        "SELECT keyword_id, keyword FROM tracked_keywords WHERE website_id = ? AND keyword_id = ?",
        [website.website_id, keywordId]
      )
    : await pool.execute(
        "SELECT keyword_id, keyword FROM tracked_keywords WHERE website_id = ?",
        [website.website_id]
      );

  if (!keywords.length) return { rowsFetched: 0, rowsInserted: 0, rowsUpdated: 0 };
  const auth = await getAuthorizedGoogleClient(userId);
  const gsc = google.searchconsole({ version: "v1", auth });
  let rowsFetched = 0;
  let rowsInserted = 0;
  let rowsUpdated = 0;
  const pageSize = 25000;

  for (const keyword of keywords) {
    let startRow = 0;
    while (true) {
      let response;
      try {
        response = await gsc.searchanalytics.query({
          siteUrl: website.gsc_property_url,
          requestBody: {
            startDate,
            endDate,
            dimensions: ["date", "query"],
            dimensionFilterGroups: [{
              filters: [{
                dimension: "query",
                operator: "equals",
                expression: keyword.keyword
              }]
            }],
            type: "web",
            rowLimit: pageSize,
            startRow,
            dataState: "all"
          }
        });
      } catch (error) {
        throw Object.assign(new Error(`Search Console keyword request failed: ${error.message}`), {
          status: 502, code: "GSC_REQUEST_FAILED"
        });
      }

      const rows = response.data.rows || [];
      for (const row of rows) {
        const [reportDate, returnedQuery] = row.keys || [];
        if (!reportDate || !returnedQuery || normalizeKeyword(returnedQuery) !== normalizeKeyword(keyword.keyword)) continue;
        const [result] = await pool.execute(
          `INSERT INTO gsc_keyword_history
           (website_id, keyword_id, report_date, clicks, impressions, ctr, average_position)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             clicks = VALUES(clicks), impressions = VALUES(impressions),
             ctr = VALUES(ctr), average_position = VALUES(average_position),
             updated_at = CURRENT_TIMESTAMP`,
          [
            website.website_id,
            keyword.keyword_id,
            reportDate,
            Math.round(row.clicks || 0),
            Math.round(row.impressions || 0),
            Number(row.ctr || 0),
            Number(row.position || 0)
          ]
        );
        if (result.affectedRows === 1) rowsInserted += 1;
        if (result.affectedRows === 2) rowsUpdated += 1;
        rowsFetched += 1;
      }
      if (rows.length < pageSize) break;
      startRow += pageSize;
    }
  }
  return { rowsFetched, rowsInserted, rowsUpdated };
}
