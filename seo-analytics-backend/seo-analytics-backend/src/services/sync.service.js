import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { addDays, assertDateRange, dateInTimezone, subtractMonths } from "../utils/dates.js";
import { syncGscRange } from "./gsc.service.js";
import { syncGscKeywordsRange } from "./gsc-keywords.service.js";
import { syncGa4Summary, syncGa4Acquisition, syncGa4TrafficAcquisition } from "./ga4.service.js";
import { HttpError } from "../utils/http-error.js";

const REPORTS = [
  { source: "ga4", reportType: "website_summary" },
  { source: "ga4", reportType: "user_acquisition" },
  { source: "ga4", reportType: "traffic_acquisition" },
  { source: "gsc", reportType: "search_console" }
];

export function sanitizeSyncError(value) {
  if (typeof value !== "string" || !value) return null;
  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/([?&](?:access_token|refresh_token|client_secret|token|key)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(access_token|refresh_token|client_secret|password|secret|authorization)\s*[:=]\s*(['"]?)[^\s,;}'"]+/gi, "$1=[redacted]")
    .slice(0, 4000);
}

export function historicalRange(timezone = "UTC") {
  const yesterday = addDays(dateInTimezone(timezone), -1);
  return { startDate: subtractMonths(yesterday, env.HISTORICAL_MONTHS), endDate: yesterday };
}

export async function enqueueSyncJob({
  websiteId,
  source,
  reportType,
  syncType,
  startDate,
  endDate,
  db = pool
}) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [websites] = await connection.execute(
      "SELECT website_id FROM website_credentials WHERE website_id = ? FOR UPDATE",
      [websiteId]
    );
    if (!websites.length) {
      throw new HttpError(404, "Website not found.", "WEBSITE_NOT_FOUND");
    }

    const [existing] = await connection.execute(
      `SELECT job_id FROM sync_jobs
       WHERE website_id = ? AND source = ? AND report_type = ?
         AND status IN ('queued','running')
       ORDER BY job_id DESC LIMIT 1`,
      [websiteId, source, reportType]
    );
    if (existing.length) {
      await connection.commit();
      return { jobId: existing[0].job_id, alreadyQueued: true };
    }

    const [result] = await connection.execute(
      `INSERT INTO sync_jobs
        (website_id, source, report_type, sync_type, status, requested_start_date, requested_end_date)
       VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
      [websiteId, source, reportType, syncType, startDate, endDate]
    );
    await connection.execute(
      `INSERT INTO sync_checkpoints (website_id, source, report_type, status)
       VALUES (?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE status = IF(status = 'running', status, 'pending')`,
      [websiteId, source, reportType]
    );
    await connection.commit();
    return { jobId: result.insertId, alreadyQueued: false };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
      const keywordResult = await syncGscKeywordsRange({ userId, website, ...chunk });
      result = {
        rowsFetched: (result.rowsFetched || 0) + (keywordResult.rowsFetched || 0),
        rowsInserted: (result.rowsInserted || 0) + (keywordResult.rowsInserted || 0),
        rowsUpdated: (result.rowsUpdated || 0) + (keywordResult.rowsUpdated || 0)
      };
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

export async function getAuthorizedJob(jobId, organizationId, db = pool) {
  const [rows] = await db.execute(
    `SELECT j.* FROM sync_jobs j
     JOIN website_credentials w ON w.website_id = j.website_id
     WHERE j.job_id = ? AND w.organization_id = ? LIMIT 1`,
    [jobId, organizationId]
  );
  if (!rows.length) throw new HttpError(404, "Sync job not found.", "SYNC_JOB_NOT_FOUND");
  return { ...rows[0], error_message: sanitizeSyncError(rows[0].error_message) };
}

export async function retrySyncJob(jobId, organizationId, db = pool) {
  const job = await getAuthorizedJob(jobId, organizationId, db);
  if (job.status !== "failed") {
    throw new HttpError(409, "Only failed jobs can be retried.", "JOB_NOT_FAILED");
  }
  const retry = await enqueueSyncJob({
    websiteId: job.website_id,
    source: job.source,
    reportType: job.report_type,
    syncType: job.sync_type,
    startDate: job.requested_start_date,
    endDate: job.requested_end_date,
    db
  });
  return {
    previousJobId: job.job_id,
    jobId: retry.jobId,
    status: "queued",
    alreadyQueued: retry.alreadyQueued
  };
}

export async function getSyncStatus(organizationId, db = pool) {
  const [rows] = await db.execute(
    `SELECT w.website_id, w.website_name, w.domain_name, w.gsc_property_url,
            report.source, report.report_type,
            cp.status AS checkpoint_status,
            cp.last_successful_date, cp.last_sync_started_at, cp.last_sync_completed_at,
            j.job_id, j.sync_type, j.status AS job_status,
            j.requested_start_date, j.requested_end_date,
            j.rows_fetched, j.rows_inserted, j.rows_updated, j.error_message,
            j.created_at AS job_created_at, j.started_at AS job_started_at, j.completed_at AS job_completed_at,
            CASE
              WHEN report.source = 'gsc' THEN
                COALESCE(LEAST(gsc.earliest_date, keyword_history.earliest_date),
                         gsc.earliest_date, keyword_history.earliest_date)
              WHEN report.report_type = 'website_summary' THEN ga4_summary.earliest_date
              WHEN report.report_type = 'user_acquisition' THEN user_acquisition.earliest_date
              ELSE traffic_acquisition.earliest_date
            END AS imported_start_date,
            CASE
              WHEN report.source = 'gsc' THEN
                COALESCE(GREATEST(gsc.latest_date, keyword_history.latest_date),
                         gsc.latest_date, keyword_history.latest_date)
              WHEN report.report_type = 'website_summary' THEN ga4_summary.latest_date
              WHEN report.report_type = 'user_acquisition' THEN user_acquisition.latest_date
              ELSE traffic_acquisition.latest_date
            END AS imported_end_date,
            CASE
              WHEN j.started_at IS NOT NULL AND j.completed_at IS NOT NULL
                THEN TIMESTAMPDIFF(MICROSECOND, j.started_at, j.completed_at) / 1000
              ELSE NULL
            END AS duration_ms,
            (SELECT MAX(successful.completed_at)
             FROM sync_jobs successful
             WHERE successful.website_id = w.website_id
               AND successful.source = report.source
               AND successful.report_type = report.report_type
               AND successful.status = 'completed') AS last_successful_sync_at
     FROM website_credentials w
     CROSS JOIN (
       SELECT 'gsc' AS source, 'search_console' AS report_type
       UNION ALL SELECT 'ga4', 'website_summary'
       UNION ALL SELECT 'ga4', 'user_acquisition'
       UNION ALL SELECT 'ga4', 'traffic_acquisition'
     ) report
     LEFT JOIN sync_checkpoints cp
       ON cp.website_id = w.website_id
       AND cp.source = report.source
       AND cp.report_type = report.report_type
     LEFT JOIN sync_jobs j
       ON j.job_id = (
         SELECT MAX(latest.job_id)
         FROM sync_jobs latest
         WHERE latest.website_id = w.website_id
           AND latest.source = report.source
           AND latest.report_type = report.report_type
       )
     LEFT JOIN (
       SELECT website_id, MIN(report_date) AS earliest_date, MAX(report_date) AS latest_date
       FROM google_search_console_data GROUP BY website_id
     ) gsc ON gsc.website_id = w.website_id
     LEFT JOIN (
       SELECT website_id, MIN(report_date) AS earliest_date, MAX(report_date) AS latest_date
       FROM gsc_keyword_history GROUP BY website_id
     ) keyword_history ON keyword_history.website_id = w.website_id
     LEFT JOIN (
       SELECT website_id, MIN(report_date) AS earliest_date, MAX(report_date) AS latest_date
       FROM google_analytics_data GROUP BY website_id
     ) ga4_summary ON ga4_summary.website_id = w.website_id
     LEFT JOIN (
       SELECT website_id, MIN(report_date) AS earliest_date, MAX(report_date) AS latest_date
       FROM user_acquisition_data GROUP BY website_id
     ) user_acquisition ON user_acquisition.website_id = w.website_id
     LEFT JOIN (
       SELECT website_id, MIN(report_date) AS earliest_date, MAX(report_date) AS latest_date
       FROM ga4_traffic_acquisition_data GROUP BY website_id
     ) traffic_acquisition ON traffic_acquisition.website_id = w.website_id
     WHERE w.organization_id = ? AND w.is_active = TRUE
     ORDER BY w.website_name, report.source, report.report_type`,
    [organizationId]
  );
  return rows.map((row) => ({
    websiteId: Number(row.website_id),
    websiteName: row.website_name,
    domainName: row.domain_name,
    source: row.source,
    reportType: row.report_type,
    configured: row.source !== "gsc" || Boolean(row.gsc_property_url),
    status: row.source === "gsc" && !row.gsc_property_url
      ? "not_configured"
      : row.job_status ?? row.checkpoint_status ?? "never_synchronized",
    jobId: row.job_id === null ? null : Number(row.job_id),
    syncType: row.sync_type ?? null,
    lastSuccessfulDate: row.last_successful_date
      ? String(row.last_successful_date).slice(0, 10)
      : null,
    lastSuccessfulSyncAt: row.last_successful_sync_at ?? row.last_sync_completed_at ?? null,
    lastAttemptedAt: row.job_started_at ?? row.job_created_at ?? row.last_sync_started_at ?? null,
    latestImportedDate: row.imported_end_date
      ? String(row.imported_end_date).slice(0, 10)
      : null,
    importedDateRange: {
      startDate: row.imported_start_date ? String(row.imported_start_date).slice(0, 10) : null,
      endDate: row.imported_end_date ? String(row.imported_end_date).slice(0, 10) : null
    },
    requestedDateRange: {
      startDate: row.requested_start_date ? String(row.requested_start_date).slice(0, 10) : null,
      endDate: row.requested_end_date ? String(row.requested_end_date).slice(0, 10) : null
    },
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    rowsFetched: row.rows_fetched === null ? null : Number(row.rows_fetched),
    rowsInserted: row.rows_inserted === null ? null : Number(row.rows_inserted),
    rowsUpdated: row.rows_updated === null ? null : Number(row.rows_updated),
    lastError: sanitizeSyncError(row.error_message),
    nextScheduledAt: null
  }));
}
