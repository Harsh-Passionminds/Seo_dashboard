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

  async function getTrafficAcquisitionDaily({
    userId,
    websiteId,
    startDate,
    endDate,
    dimensionType,
    dimensionValue
  }) {
    const dimensionFilter = dimensionValue === undefined ? "" : " AND dimension_value = ?";
    const parameters = [
      userId,
      websiteId,
      dimensionType,
      startDate,
      endDate,
      ...(dimensionValue === undefined ? [] : [dimensionValue])
    ];
    const [rows] = await db.execute(
      `SELECT report_date, SUM(sessions) AS sessions, SUM(engaged_sessions) AS engaged_sessions
       FROM ga4_traffic_acquisition_data
       WHERE user_id = ? AND website_id = ? AND dimension_type = ?
         AND report_date BETWEEN ? AND ?${dimensionFilter}
       GROUP BY report_date
       ORDER BY report_date ASC`,
      parameters
    );
    return rows.map((row) => {
      const sessions = Number(row.sessions);
      const engagedSessions = Number(row.engaged_sessions);
      return {
        report_date: String(row.report_date).slice(0, 10),
        date: String(row.report_date).slice(0, 10),
        sessions,
        engagedSessions,
        engagementRate: sessions > 0 ? engagedSessions / sessions : null
      };
    });
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

  async function getUnifiedKeywordReport({
    websiteId,
    startDate,
    endDate,
    search,
    sort,
    order,
    limit,
    offset
  }) {
    const searchClause = search ? "AND LOCATE(LOWER(?), LOWER(k.keyword)) > 0" : "";
    const searchParameters = search ? [search] : [];
    const sortColumns = {
      keyword: "k.keyword",
      averagePosition: "average_position",
      previousAveragePosition: "previous_average_position",
      positionChange: "(average_position - previous_average_position)",
      clicks: "period.clicks",
      impressions: "period.impressions",
      ctr: "period.ctr",
      lastUpdated: "last_observation_date",
      trackingStatus: "tracking_status"
    };
    const sortColumn = sortColumns[sort];
    if (!sortColumn || (order !== "asc" && order !== "desc")) {
      throw new TypeError("Keyword report sort options must be validated before querying.");
    }
    const sortDirection = order === "desc" ? "DESC" : "ASC";

    const [countRows] = await db.execute(
      `SELECT COUNT(*) AS total
       FROM tracked_keywords k
       WHERE k.website_id = ? ${searchClause}`,
      [websiteId, ...searchParameters]
    );
    const [rows] = await db.execute(
      `SELECT k.keyword_id, k.website_id, k.keyword, k.created_at, k.updated_at,
              period.clicks, period.impressions, period.ctr,
              (SELECT h.average_position
               FROM gsc_keyword_history h
               WHERE h.website_id = k.website_id AND h.keyword_id = k.keyword_id
                 AND h.report_date BETWEEN ? AND ?
               ORDER BY h.report_date DESC LIMIT 1) AS average_position,
              (SELECT h.average_position
               FROM gsc_keyword_history h
               WHERE h.website_id = k.website_id AND h.keyword_id = k.keyword_id
                 AND h.report_date < ?
               ORDER BY h.report_date DESC LIMIT 1) AS previous_average_position,
              (SELECT MAX(h.report_date)
               FROM gsc_keyword_history h
               WHERE h.website_id = k.website_id AND h.keyword_id = k.keyword_id
                 AND h.report_date <= ?) AS last_observation_date,
              CASE
                WHEN period.latest_date IS NOT NULL THEN 'updated'
                WHEN EXISTS (
                  SELECT 1 FROM gsc_keyword_history h
                  WHERE h.website_id = k.website_id AND h.keyword_id = k.keyword_id
                    AND h.report_date <= ?
                ) THEN 'not_recently_updated'
                ELSE 'no_history'
              END AS tracking_status
       FROM tracked_keywords k
       LEFT JOIN (
         SELECT keyword_id, SUM(clicks) AS clicks, SUM(impressions) AS impressions,
                SUM(clicks) / NULLIF(SUM(impressions), 0) AS ctr, MAX(report_date) AS latest_date
         FROM gsc_keyword_history
         WHERE website_id = ? AND report_date BETWEEN ? AND ?
         GROUP BY keyword_id
       ) period ON period.keyword_id = k.keyword_id
       WHERE k.website_id = ? ${searchClause}
       ORDER BY (${sortColumn} IS NULL) ASC, ${sortColumn} ${sortDirection}, k.keyword_id ASC
       LIMIT ? OFFSET ?`,
      [
        startDate,
        endDate,
        startDate,
        endDate,
        endDate,
        websiteId,
        startDate,
        endDate,
        websiteId,
        ...searchParameters,
        limit,
        offset
      ]
    );
    return { rows, total: Number(countRows[0]?.total ?? 0) };
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
    getTrafficAcquisitionDaily,
    getSyncMetadata,
    getKeywordReportRows,
    getUnifiedKeywordReport,
    getReportExportPolicy,
    recordReportExport
  };
}

export const reportsRepository = createReportsRepository();
