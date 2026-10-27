import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { getAuthorizedJob } from "../services/sync.service.js";
import { pool } from "../db/pool.js";

export const syncRouter = express.Router();
syncRouter.use(requireAuth);

// GET /api/sync-jobs — list recent jobs for the signed-in user
syncRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.user.user_id;

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
         j.error_message,
         j.created_at,
         j.started_at,
         j.completed_at
       FROM sync_jobs AS j
       INNER JOIN website_credentials AS w
         ON w.website_id = j.website_id
       WHERE w.owner_user_id = ?
       ORDER BY j.job_id DESC
       LIMIT 100`,
      [userId]
    );

    res.json({ jobs });
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
    const job = await getAuthorizedJob(jobId, req.user.user_id);
    res.json({ job });
  } catch (error) {
    next(error);
  }
});

syncRouter.post("/:jobId/retry", async (req, res, next) => {
  try {
    const jobId = Number(req.params.jobId);
    const job = await getAuthorizedJob(jobId, req.user.user_id);
    if (job.status !== "failed") {
      return res.status(409).json({ error: { code: "JOB_NOT_FAILED", message: "Only failed jobs can be retried." } });
    }
    await (await import("../db/pool.js")).pool.execute(
      "UPDATE sync_jobs SET status = 'queued', attempt_count = 0, error_message = NULL, completed_at = NULL WHERE job_id = ?",
      [jobId]
    );
    res.status(202).json({ jobId, status: "queued" });
  } catch (error) {
    next(error);
  }
});
