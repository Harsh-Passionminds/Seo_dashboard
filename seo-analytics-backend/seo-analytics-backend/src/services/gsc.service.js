import { google } from "googleapis";
import { pool } from "../db/pool.js";
import { getAuthorizedGoogleClient } from "./google-oauth.service.js";

export async function syncGscRange({ userId, website, startDate, endDate }) {
  if (!website.gsc_property_url) {
    throw Object.assign(new Error("This website has no GSC property URL configured."), { status: 400, code: "GSC_PROPERTY_MISSING" });
  }
  const auth = await getAuthorizedGoogleClient(userId);
  const gsc = google.searchconsole({ version: "v1", auth });
  const property = website.gsc_property_url;
  let startRow = 0;
  let rowsFetched = 0;
  let rowsInserted = 0;
  let rowsUpdated = 0;
  const pageSize = 25000;

  while (true) {
    let response;
    try {
      response = await gsc.searchanalytics.query({
        siteUrl: property,
        requestBody: {
          startDate,
          endDate,
          dimensions: ["date"],
          rowLimit: pageSize,
          startRow,
          dataState: "all"
        }
      });
    } catch (error) {
      throw Object.assign(new Error(`Search Console request failed: ${error.message}`), {
        status: 502, code: "GSC_REQUEST_FAILED"
      });
    }
    const rows = response.data.rows || [];
    for (const row of rows) {
      const reportDate = row.keys?.[0];
      if (!reportDate) continue;
      const [result] = await pool.execute(
        `INSERT INTO google_search_console_data
         (website_id, report_date, clicks, impressions, ctr, average_position)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           clicks = VALUES(clicks), impressions = VALUES(impressions),
           ctr = VALUES(ctr), average_position = VALUES(average_position),
           updated_at = CURRENT_TIMESTAMP`,
        [
          website.website_id, reportDate, Math.round(row.clicks || 0),
          Math.round(row.impressions || 0), Number(row.ctr || 0), Number(row.position || 0)
        ]
      );
      if (result.affectedRows === 1) rowsInserted += 1;
      if (result.affectedRows === 2) rowsUpdated += 1;
      rowsFetched += 1;
    }
    if (rows.length < pageSize) break;
    startRow += pageSize;
  }
  return { rowsFetched, rowsInserted, rowsUpdated };
}
