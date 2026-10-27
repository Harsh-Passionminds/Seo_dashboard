import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { processSyncJob } from "./sync.service.js";

let timer = null;
let running = false;

async function runOneJob() {
  if (running) return;
  running = true;
  let job = null;
  try {
    const [queued] = await pool.execute(
      "SELECT * FROM sync_jobs WHERE status = 'queued' ORDER BY job_id ASC LIMIT 1"
    );
    if (!queued.length) return;
    const candidate = queued[0];
    const [update] = await pool.execute(
      `UPDATE sync_jobs SET status = 'running', started_at = COALESCE(started_at, NOW()),
         attempt_count = attempt_count + 1, error_message = NULL, updated_at = NOW()
       WHERE job_id = ? AND status = 'queued'`,
      [candidate.job_id]
    );
    if (!update.affectedRows) return;
    job = candidate;
    await pool.execute(
      `UPDATE sync_checkpoints SET status = 'running', last_sync_started_at = NOW()
       WHERE website_id = ? AND source = ? AND report_type = ?`,
      [job.website_id, job.source, job.report_type]
    );
    const result = await processSyncJob(job);
    await pool.execute(
      `UPDATE sync_jobs SET status = 'completed', rows_fetched = ?, completed_at = NOW(),
         updated_at = NOW(), error_message = NULL WHERE job_id = ?`,
      [result.rowsFetched || 0, job.job_id]
    );
    await pool.execute(
      `UPDATE sync_checkpoints SET status = 'completed', last_sync_completed_at = NOW()
       WHERE website_id = ? AND source = ? AND report_type = ?`,
      [job.website_id, job.source, job.report_type]
    );
  } catch (error) {
    if (job) {
      const [rows] = await pool.execute("SELECT attempt_count FROM sync_jobs WHERE job_id = ?", [job.job_id]);
      const attempts = rows[0]?.attempt_count || 1;
      const status = attempts < env.MAX_SYNC_ATTEMPTS ? "queued" : "failed";
      const safeMessage = String(error.message || "Sync failed").slice(0, 4000);
      await pool.execute(
        `UPDATE sync_jobs SET status = ?, error_message = ?, completed_at = IF(? = 'failed', NOW(), NULL),
           updated_at = NOW() WHERE job_id = ?`,
        [status, safeMessage, status, job.job_id]
      );
      await pool.execute(
        `UPDATE sync_checkpoints SET status = 'failed'
         WHERE website_id = ? AND source = ? AND report_type = ?`,
        [job.website_id, job.source, job.report_type]
      );
      console.error(`Sync job ${job.job_id} ${status}: ${safeMessage}`);
    } else {
      console.error("Sync worker error:", error.message);
    }
  } finally {
    running = false;
  }
}

export function startSyncWorker() {
  if (!env.syncWorkerEnabled || timer) return;
  timer = setInterval(() => void runOneJob(), env.SYNC_POLL_INTERVAL_MS);
  timer.unref?.();
  void runOneJob();
  console.log(`Sync worker enabled; polling every ${env.SYNC_POLL_INTERVAL_MS}ms`);
}

export function stopSyncWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
