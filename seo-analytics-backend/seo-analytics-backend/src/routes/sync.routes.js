import express from "express";
import { requireAuth, requireOrganizationMembership, requirePasswordChange, requireRole } from "../middleware/auth.js";
import {
  getAuthorizedJob,
  getSyncStatus,
  retrySyncJob,
  sanitizeSyncError
} from "../services/sync.service.js";
import { pool } from "../db/pool.js";

export const syncRouter = express.Router();
syncRouter.use(requireAuth, requireOrganizationMembership, requirePasswordChange, requireRole("admin"));

syncRouter.get("/status", async (req, res, next) => {
  try {
    const status = await getSyncStatus(req.organization.organization_id);
    res.json({ status });
  } catch (error) {
    next(error);
  }
});

// GET /api/sync-jobs — list recent jobs for the signed-in user
syncRouter.get("/", async (req, res, next) => {
  try {
    const [jobs] = await pool.execute(
      `SELECT
         j.job_id,
         j.website_id,
         w.website_name,
         j.source,
         j.report_type,
         j.sync_type,
         j.status,
         j.requested_start_date,
         j.requested_end_date,
         j.rows_fetched,
         j.rows_inserted,
         j.rows_updated,
         j.attempt_count,
         j.error_message,
         j.created_at,
         j.started_at,
         j.completed_at,
         CASE
           WHEN j.started_at IS NOT NULL AND j.completed_at IS NOT NULL
             THEN TIMESTAMPDIFF(MICROSECOND, j.started_at, j.completed_at) / 1000
           ELSE NULL
         END AS duration_ms
       FROM sync_jobs AS j
       INNER JOIN website_credentials AS w
         ON w.website_id = j.website_id
       WHERE w.organization_id = ?
       ORDER BY j.job_id DESC
       LIMIT 100`,
      [req.organization.organization_id]
    );

    res.json({
      jobs: jobs.map((job) => ({ ...job, error_message: sanitizeSyncError(job.error_message) }))
    });
  } catch (error) {
    next(error);
  }
});

syncRouter.get("/:jobId", async (req, res, next) => {
  try {
    const jobId = Number(req.params.jobId);
    if (!Number.isSafeInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ error: { code: "INVALID_JOB_ID", message: "Invalid sync job ID." } });
    }
    const job = await getAuthorizedJob(jobId, req.organization.organization_id);
    res.json({ job });
  } catch (error) {
    next(error);
  }
});

syncRouter.post("/:jobId/retry", async (req, res, next) => {
  try {
    const jobId = Number(req.params.jobId);
    if (!Number.isSafeInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ error: { code: "INVALID_JOB_ID", message: "Invalid sync job ID." } });
    }
    const retry = await retrySyncJob(jobId, req.organization.organization_id);
    res.status(202).json(retry);
  } catch (error) {
    next(error);
  }
});
