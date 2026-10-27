import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireWebsiteOwnership } from "../middleware/auth.js";
import { assertDateRange } from "../utils/dates.js";
import { HttpError } from "../utils/http-error.js";
import { getGa4Acquisition, getTrafficAcquisitionReport } from "../services/ga4.service.js";
import { requestTrafficAcquisitionSync } from "../services/sync.service.js";

export const reportsRouter = express.Router();
reportsRouter.use(requireAuth);

function dateRange(req) {
  return assertDateRange(req.query.startDate, req.query.endDate);
}

async function syncMetadata(websiteId) {
  const [checkpoints] = await pool.execute(
    `SELECT source, report_type, last_successful_date, last_sync_completed_at, status
     FROM sync_checkpoints WHERE website_id = ?`,
    [websiteId]
  );
  const [jobs] = await pool.execute(
    `SELECT job_id, source, report_type, status, requested_start_date, requested_end_date,
            rows_fetched, error_message, created_at, completed_at
     FROM sync_jobs WHERE website_id = ? ORDER BY job_id DESC LIMIT 20`,
    [websiteId]
  );
  return { checkpoints, recentJobs: jobs };
}

reportsRouter.get("/:websiteId/overview", requireWebsiteOwnership, async (req, res, next) => {
  try {
    const { startDate, endDate } = dateRange(req);
    const websiteId = req.website.website_id;
    const [[gscRows], [ga4Rows], trafficReports, [userRows], sync] = await Promise.all([
      pool.execute(
        `SELECT report_date, clicks, impressions, ctr, average_position
         FROM google_search_console_data
         WHERE website_id = ? AND report_date BETWEEN ? AND ? ORDER BY report_date`,
        [websiteId, startDate, endDate]
      ),
      pool.execute(
        `SELECT report_date, organic_sessions, form_submit_conversions,
                from_submit_conversions, total_form_conversions
         FROM google_analytics_data
         WHERE website_id = ? AND report_date BETWEEN ? AND ? ORDER BY report_date`,
        [websiteId, startDate, endDate]
      ),
      Promise.all([
        getTrafficAcquisitionReport({
          userId: req.user.user_id,
          websiteId,
          startDate,
          endDate,
          dimensionType: "default_channel_group"
        }),
        getTrafficAcquisitionReport({
          userId: req.user.user_id,
          websiteId,
          startDate,
          endDate,
          dimensionType: "source_medium"
        })
      ]),
      pool.execute(
        `SELECT report_date, dimension_name, dimension_value, dimensions_json, metrics_json
         FROM user_acquisition_data
         WHERE user_id = ? AND website_id = ? AND report_date BETWEEN ? AND ?
         ORDER BY report_date`,
        [req.user.user_id, websiteId, startDate, endDate]
      ),
      syncMetadata(websiteId)
    ]);
    res.json({
      website: {
        websiteId,
        websiteName: req.website.website_name,
        domainName: req.website.domain_name,
        ga4PropertyId: req.website.ga4_property_id,
        gscPropertyUrl: req.website.gsc_property_url
      },
      dateRange: { startDate, endDate },
      data: {
        googleSearchConsole: gscRows,
        googleAnalytics: ga4Rows,
        trafficAcquisition: {
          defaultChannelGroup: trafficReports[0],
          sourceMedium: trafficReports[1]
        },
        userAcquisition: userRows
      },
      sync
    });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get("/:websiteId/gsc", requireWebsiteOwnership, async (req, res, next) => {
  try {
    const { startDate, endDate } = dateRange(req);
    const [rows] = await pool.execute(
      `SELECT report_date, clicks, impressions, ctr, average_position
       FROM google_search_console_data
       WHERE website_id = ? AND report_date BETWEEN ? AND ?
       ORDER BY report_date`,
      [req.website.website_id, startDate, endDate]
    );
    res.json({ websiteId: req.website.website_id, dateRange: { startDate, endDate }, rows });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get("/:websiteId/ga4", requireWebsiteOwnership, async (req, res, next) => {
  try {
    const { startDate, endDate } = dateRange(req);
    const reportType = String(req.query.reportType || "summary");
    if (reportType === "traffic_acquisition") {
      const dimensionType = String(req.query.dimensionType || "default_channel_group");
      const report = await getTrafficAcquisitionReport({
        userId: req.user.user_id,
        websiteId: req.website.website_id,
        startDate,
        endDate,
        dimensionType
      });
      return res.json({
        websiteId: req.website.website_id,
        reportType,
        dimensionType,
        dateRange: { startDate, endDate },
        count: report.rows.length,
        rows: report.rows,
        total: report.total
      });
    }
    if (reportType === "user_acquisition") {
      const dimensionType = String(req.query.dimensionType || "default_channel_group");
      const rows = await getGa4Acquisition({
        userId: req.user.user_id,
        websiteId: req.website.website_id,
        startDate,
        endDate,
        reportType,
        dimensionType
      });
      return res.json({
        websiteId: req.website.website_id,
        reportType,
        dimensionType,
        dateRange: { startDate, endDate },
        count: rows.length,
        rows
      });
    }

    let table;
    let columns;
    if (reportType === "summary") {
      table = "google_analytics_data";
      columns = "report_date, organic_sessions, form_submit_conversions, from_submit_conversions, total_form_conversions";
    } else {
      throw new HttpError(400, "reportType must be summary, user_acquisition, or traffic_acquisition.", "INVALID_REPORT_TYPE");
    }
    const [rows] = await pool.execute(
      `SELECT ${columns} FROM ${table}
       WHERE website_id = ? AND report_date BETWEEN ? AND ?
       ORDER BY report_date`,
      [req.website.website_id, startDate, endDate]
    );
    res.json({ websiteId: req.website.website_id, reportType, dateRange: { startDate, endDate }, rows });
  } catch (error) {
    next(error);
  }
});

reportsRouter.post("/:websiteId/traffic-acquisition/sync", requireWebsiteOwnership, async (req, res, next) => {
  try {
    const { startDate, endDate } = assertDateRange(req.body?.startDate, req.body?.endDate);
    const job = await requestTrafficAcquisitionSync(req.website, { startDate, endDate });
    res.status(202).json({
      websiteId: req.website.website_id,
      source: "ga4",
      reportType: "traffic_acquisition",
      dateRange: { startDate, endDate },
      ...job
    });
  } catch (error) {
    next(error);
  }
});
