import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { addDays, assertDateRange, dateInTimezone, subtractMonths } from "../utils/dates.js";
import { syncGscRange } from "./gsc.service.js";
import { syncGa4Summary, syncGa4Acquisition, syncGa4TrafficAcquisition } from "./ga4.service.js";
import { HttpError } from "../utils/http-error.js";

const REPORTS = [
  { source: "ga4", reportType: "website_summary" },
  { source: "ga4", reportType: "user_acquisition" },
  { source: "ga4", reportType: "traffic_acquisition" },
  { source: "gsc", reportType: "search_console" }
];

export function historicalRange(timezone = "UTC") {
  const yesterday = addDays(dateInTimezone(timezone), -1);
  return { startDate: subtractMonths(yesterday, env.HISTORICAL_MONTHS), endDate: yesterday };
}

export async function enqueueSyncJob({ websiteId, source, reportType, syncType, startDate, endDate }) {
  const [existing] = await pool.execute(
    `SELECT job_id FROM sync_jobs
     WHERE website_id = ? AND source = ? AND report_type = ?
       AND status IN ('queued', 'running')
     ORDER BY job_id DESC LIMIT 1`,
    [websiteId, source, reportType]
  );
  if (existing.length) return { jobId: existing[0].job_id, alreadyQueued: true };

  const [result] = await pool.execute(
    `INSERT INTO sync_jobs
      (website_id, source, report_type, sync_type, status, requested_start_date, requested_end_date)
     VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
    [websiteId, source, reportType, syncType, startDate, endDate]
  );
  await pool.execute(
    `INSERT INTO sync_checkpoints (website_id, source, report_type, status)
     VALUES (?, ?, ?, 'pending')
     ON DUPLICATE KEY UPDATE status = IF(status = 'running', status, 'pending')`,
    [websiteId, source, reportType]
  );
  return { jobId: result.insertId, alreadyQueued: false };
}

export async function enqueueHistoricalBackfill(website) {
  const range = historicalRange(website.timezone || "UTC");
  const jobs = [];
  for (const report of REPORTS) {
    if (report.source === "gsc" && !website.gsc_property_url) continue;
    jobs.push({
      ...report,
      ...await enqueueSyncJob({
        websiteId: website.website_id,
        ...report,
        syncType: "historical",
        ...range
      })
    });
  }
  return jobs;
}

export async function ensureFreshnessForUser(userId) {
  const [websites] = await pool.execute(
    "SELECT * FROM website_credentials WHERE owner_user_id = ? AND is_active = TRUE",
    [userId]
  );
  const now = Date.now();
  const jobs = [];
  for (const website of websites) {
    for (const report of REPORTS) {
      if (report.source === "gsc" && !website.gsc_property_url) continue;
      const [checkpoints] = await pool.execute(
        `SELECT last_successful_date, last_sync_completed_at, status
         FROM sync_checkpoints
         WHERE website_id = ? AND source = ? AND report_type = ? LIMIT 1`,
        [website.website_id, report.source, report.reportType]
      );
      const checkpoint = checkpoints[0];
      const range = historicalRange(website.timezone || "UTC");
      let syncType = "historical";
      let startDate = range.startDate;
      let endDate = range.endDate;

      if (checkpoint?.last_successful_date) {
        const completedAt = checkpoint.last_sync_completed_at
          ? new Date(checkpoint.last_sync_completed_at).getTime()
          : 0;
        const freshnessMs = env.SYNC_FRESHNESS_HOURS * 60 * 60 * 1000;
        if (completedAt && now - completedAt < freshnessMs) continue;

        syncType = "incremental";
        const lookback = report.source === "gsc" ? env.GSC_LOOKBACK_DAYS : env.GA4_LOOKBACK_DAYS;
        startDate = addDays(String(checkpoint.last_successful_date).slice(0, 10), -lookback);
        if (startDate < range.startDate) startDate = range.startDate;
      }
      if (startDate > endDate) continue;
      const job = await enqueueSyncJob({
        websiteId: website.website_id, ...report, syncType, startDate, endDate
      });
      jobs.push({ websiteId: website.website_id, ...report, ...job });
    }
  }
  return jobs;
}

async function updateCheckpoint(websiteId, source, reportType, startDate, endDate, status) {
  await pool.execute(
    `INSERT INTO sync_checkpoints
      (website_id, source, report_type, last_successful_date,
       last_sync_started_at, last_sync_completed_at, status)
     VALUES (?, ?, ?, ?, NOW(), IF(? = 'completed', NOW(), NULL), ?)
     ON DUPLICATE KEY UPDATE
       last_successful_date = IF(? = 'completed',
         GREATEST(COALESCE(last_successful_date, '1000-01-01'), VALUES(last_successful_date)),
         last_successful_date),
       last_sync_started_at = IF(? = 'running', NOW(), last_sync_started_at),
       last_sync_completed_at = IF(? = 'completed', NOW(), last_sync_completed_at),
       status = ?`,
    [websiteId, source, reportType, endDate, status, status, status, status, status, status]
  );
}

export async function processSyncJob(job) {
  const [websites] = await pool.execute(
    `SELECT w.*, u.user_id AS sync_user_id
     FROM website_credentials w
     JOIN users u ON u.user_id = w.owner_user_id
     WHERE w.website_id = ? AND w.is_active = TRUE
     LIMIT 1`,
    [job.website_id]
  );
  const website = websites[0];
  if (!website) throw new Error("Website no longer exists or is inactive.");
  const userId = website.sync_user_id;
  website.owner_user_id = userId;

  const startDate = String(job.requested_start_date).slice(0, 10);
  const endDate = String(job.requested_end_date).slice(0, 10);
  const chunks = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const chunkEndCandidate = addDays(cursor, env.SYNC_CHUNK_DAYS - 1);
    const chunkEnd = chunkEndCandidate < endDate ? chunkEndCandidate : endDate;
    chunks.push({ startDate: cursor, endDate: chunkEnd });
    cursor = addDays(chunkEnd, 1);
  }

  let totalRows = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  await updateCheckpoint(website.website_id, job.source, job.report_type, startDate, startDate, "running");
  for (const chunk of chunks) {
    let result;
    if (job.source === "gsc" && job.report_type === "search_console") {
      result = await syncGscRange({ userId, website, ...chunk });
    } else if (job.source === "ga4" && job.report_type === "website_summary") {
      result = await syncGa4Summary({ userId, website, ...chunk });
    } else if (job.source === "ga4" && job.report_type === "user_acquisition") {
      result = await syncGa4Acquisition({ userId, website, ...chunk, reportType: job.report_type });
    } else if (job.source === "ga4" && job.report_type === "traffic_acquisition") {
      result = await syncGa4TrafficAcquisition({ userId, website, ...chunk });
    } else {
      throw new Error(`Unsupported sync job: ${job.source}/${job.report_type}`);
    }
    totalRows += result.rowsFetched || 0;
    totalInserted += result.rowsInserted || 0;
    totalUpdated += result.rowsUpdated || 0;
    await pool.execute(
      `UPDATE sync_jobs SET rows_fetched = ?, rows_inserted = ?, rows_updated = ?,
         last_successful_date = ?, updated_at = NOW()
       WHERE job_id = ?`,
      [totalRows, totalInserted, totalUpdated, chunk.endDate, job.job_id]
    );
    await updateCheckpoint(website.website_id, job.source, job.report_type, chunk.startDate, chunk.endDate, "completed");
  }
  return { rowsFetched: totalRows, rowsInserted: totalInserted, rowsUpdated: totalUpdated };
}

export async function requestManualSync(userId, website) {
  const range = historicalRange(website.timezone || "UTC");
  const reports = REPORTS.filter((report) => report.source !== "gsc" || website.gsc_property_url);
  const result = [];
  for (const report of reports) {
    const [checkpoints] = await pool.execute(
      `SELECT last_successful_date FROM sync_checkpoints
       WHERE website_id = ? AND source = ? AND report_type = ? LIMIT 1`,
      [website.website_id, report.source, report.reportType]
    );
    const checkpoint = checkpoints[0];
    const lookback = report.source === "gsc" ? env.GSC_LOOKBACK_DAYS : env.GA4_LOOKBACK_DAYS;
    const startDate = checkpoint?.last_successful_date
      ? addDays(String(checkpoint.last_successful_date).slice(0, 10), -lookback)
      : range.startDate;
    result.push({
      ...report,
      ...await enqueueSyncJob({
        websiteId: website.website_id,
        ...report,
        syncType: checkpoint ? "manual" : "historical",
        startDate: startDate < range.startDate ? range.startDate : startDate,
        endDate: range.endDate
      })
    });
  }
  return result;
}

export async function requestTrafficAcquisitionSync(website, { startDate, endDate }) {
  const range = assertDateRange(startDate, endDate);
  return enqueueSyncJob({
    websiteId: website.website_id,
    source: "ga4",
    reportType: "traffic_acquisition",
    syncType: "manual",
    startDate: range.startDate,
    endDate: range.endDate
  });
}

export async function getAuthorizedJob(jobId, userId) {
  const [rows] = await pool.execute(
    `SELECT j.* FROM sync_jobs j
     JOIN website_credentials w ON w.website_id = j.website_id
     WHERE j.job_id = ? AND w.owner_user_id = ? LIMIT 1`,
    [jobId, userId]
  );
  if (!rows.length) throw new HttpError(404, "Sync job not found.", "SYNC_JOB_NOT_FOUND");
  return rows[0];
}
