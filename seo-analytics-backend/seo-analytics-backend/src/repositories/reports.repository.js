import { pool } from "../db/pool.js";

export function createReportsRepository(db = pool) {
  async function getGscDaily(websiteId, startDate, endDate) {
    const [rows] = await db.execute(
      `SELECT report_date, clicks, impressions, ctr, average_position
       FROM google_search_console_data
       WHERE website_id = ? AND report_date BETWEEN ? AND ?
       ORDER BY report_date`,
      [websiteId, startDate, endDate]
    );
    return rows;
  }

  async function getGa4Summary(websiteId, startDate, endDate) {
    const [rows] = await db.execute(
      `SELECT report_date, organic_sessions, form_submit_conversions,
              from_submit_conversions, total_form_conversions
       FROM google_analytics_data
       WHERE website_id = ? AND report_date BETWEEN ? AND ?
       ORDER BY report_date`,
      [websiteId, startDate, endDate]
    );
    return rows;
  }

  async function getUserAcquisition(userId, websiteId, startDate, endDate) {
    const [rows] = await db.execute(
      `SELECT report_date, dimension_name, dimension_value, dimensions_json, metrics_json
       FROM user_acquisition_data
       WHERE user_id = ? AND website_id = ? AND report_date BETWEEN ? AND ?
       ORDER BY report_date`,
      [userId, websiteId, startDate, endDate]
    );
    return rows;
  }

  async function getSyncMetadata(websiteId) {
    const [[checkpoints], [recentJobs]] = await Promise.all([
      db.execute(
        `SELECT source, report_type, last_successful_date, last_sync_completed_at, status
         FROM sync_checkpoints WHERE website_id = ?`,
        [websiteId]
      ),
      db.execute(
        `SELECT job_id, source, report_type, status, requested_start_date, requested_end_date,
                rows_fetched, error_message, created_at, completed_at
         FROM sync_jobs WHERE website_id = ? ORDER BY job_id DESC LIMIT 20`,
        [websiteId]
      )
    ]);
    return { checkpoints, recentJobs };
  }

  async function getKeywordReportRows({
    websiteId,
    startDate,
    endDate,
    keywordId,
    keyword,
    rowLimit
  }) {
    const filters = [];
    const parameters = [websiteId, startDate, endDate];
    if (keywordId !== undefined) {
      filters.push("k.keyword_id = ?");
      parameters.push(keywordId);
    }
    if (keyword !== undefined) {
      filters.push("k.keyword_normalized = ?");
      parameters.push(String(keyword).trim().replace(/\s+/g, " ").toLowerCase());
    }
    parameters.push(rowLimit);
    const [rows] = await db.execute(
      `SELECT h.report_date, h.keyword_id, k.keyword,
              h.clicks, h.impressions, h.ctr, h.average_position
       FROM gsc_keyword_history h
       JOIN tracked_keywords k
         ON k.website_id = h.website_id AND k.keyword_id = h.keyword_id
       WHERE h.website_id = ? AND h.report_date BETWEEN ? AND ?
         ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
       ORDER BY h.report_date ASC, k.keyword ASC
       LIMIT ?`,
      parameters
    );
    return rows;
  }

  async function getReportExportPolicy({ organizationId, userId, websiteId }) {
    const [rows] = await db.execute(
      `SELECT m.role, o.report_exports_enabled, o.viewer_exports_enabled
       FROM organization_members m
       JOIN organizations o ON o.organization_id = m.organization_id
       JOIN website_credentials w
         ON w.organization_id = o.organization_id
       WHERE m.organization_id = ? AND m.user_id = ?
         AND m.status = 'active' AND o.status = 'active'
         AND w.website_id = ? AND w.is_active = TRUE
       LIMIT 1`,
      [organizationId, userId, websiteId]
    );
    return rows[0] ?? null;
  }

  async function recordReportExport({
    organizationId,
    userId,
    websiteId,
    source,
    format,
    startDate,
    endDate,
    metrics,
    dimensions,
    filters
  }) {
    const metadata = JSON.stringify({
      websiteId: Number(websiteId),
      source,
      format,
      startDate,
      endDate,
      metrics,
      dimensions,
      filters
    });
    await db.execute(
      `INSERT INTO activity_logs
       (organization_id, actor_user_id, action, resource_type, resource_id, metadata)
       VALUES (?, ?, 'report.exported', 'report_export', ?, ?)`,
      [organizationId, userId, String(websiteId), metadata]
    );
  }

  return {
    getGscDaily,
    getGa4Summary,
    getUserAcquisition,
    getSyncMetadata,
    getKeywordReportRows,
    getReportExportPolicy,
    recordReportExport
  };
}

export const reportsRepository = createReportsRepository();
