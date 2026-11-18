import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueueSyncJob,
  getSyncStatus,
  retrySyncJob,
  sanitizeSyncError
} from "../src/services/sync.service.js";

function fakeConnection({ existingJob = null } = {}) {
  const calls = [];
  return {
    calls,
    async beginTransaction() { calls.push(["begin"]); },
    async commit() { calls.push(["commit"]); },
    async rollback() { calls.push(["rollback"]); },
    release() { calls.push(["release"]); },
    async execute(sql, params) {
      calls.push([sql, params]);
      if (sql.includes("FROM website_credentials")) return [[{ website_id: params[0] }]];
      if (sql.includes("FROM sync_jobs") && sql.includes("status IN")) {
        return [existingJob ? [{ job_id: existingJob }] : []];
      }
      if (sql.includes("INSERT INTO sync_jobs")) return [{ insertId: 55 }];
      if (sql.includes("INSERT INTO sync_checkpoints")) return [{ affectedRows: 1 }];
      return [[]];
    }
  };
}

test("sync enqueue locks the website and reuses an active job rather than duplicating it", async () => {
  const connection = fakeConnection({ existingJob: 41 });
  const db = { async getConnection() { return connection; } };
  const result = await enqueueSyncJob({
    websiteId: 12,
    source: "gsc",
    reportType: "search_console",
    syncType: "manual",
    startDate: "2026-11-01",
    endDate: "2026-11-17",
    db
  });

  assert.deepEqual(result, { jobId: 41, alreadyQueued: true });
  assert.match(connection.calls[1][0], /FOR UPDATE/);
  assert.equal(connection.calls.filter(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO sync_jobs")).length, 0);
  assert.ok(connection.calls.some(([name]) => name === "commit"));
});

test("sync enqueue creates the job and checkpoint in one transaction", async () => {
  const connection = fakeConnection();
  const db = { async getConnection() { return connection; } };
  const result = await enqueueSyncJob({
    websiteId: 12,
    source: "ga4",
    reportType: "website_summary",
    syncType: "historical",
    startDate: "2025-01-01",
    endDate: "2026-11-17",
    db
  });

  assert.deepEqual(result, { jobId: 55, alreadyQueued: false });
  assert.ok(connection.calls.some(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO sync_jobs")));
  assert.ok(connection.calls.some(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO sync_checkpoints")));
  assert.equal(connection.calls.filter(([name]) => name === "commit").length, 1);
});

test("sync status is derived from organization-scoped job, checkpoint, and persisted-range rows", async () => {
  let received;
  const db = {
    async execute(sql, params) {
      received = { sql, params };
      return [[{
        website_id: 12,
        website_name: "Example",
        domain_name: "https://example.test",
        gsc_property_url: "sc-domain:example.test",
        source: "gsc",
        report_type: "search_console",
        checkpoint_status: "failed",
        last_successful_date: "2026-11-10",
        last_sync_completed_at: "2026-11-10 02:00:00",
        job_id: 88,
        sync_type: "incremental",
        job_status: "failed",
        requested_start_date: "2026-11-08",
        requested_end_date: "2026-11-17",
        rows_fetched: 4,
        rows_inserted: 2,
        rows_updated: 2,
        error_message: "Google request failed",
        job_created_at: "2026-11-18 01:00:00",
        job_started_at: "2026-11-18 01:01:00",
        job_completed_at: "2026-11-18 01:03:00",
        imported_start_date: "2025-06-25",
        imported_end_date: "2026-11-17",
        duration_ms: 120000,
        last_successful_sync_at: "2026-11-10 02:00:00"
      }]];
    }
  };

  const status = await getSyncStatus(3, db);
  assert.deepEqual(received.params, [3]);
  assert.match(received.sql, /w\.organization_id = \? AND w\.is_active = TRUE/);
  assert.match(received.sql, /FROM google_search_console_data/);
  assert.equal(status[0].status, "failed");
  assert.equal(status[0].rowsInserted, 2);
  assert.equal(status[0].durationMs, 120000);
  assert.deepEqual(status[0].importedDateRange, { startDate: "2025-06-25", endDate: "2026-11-17" });
  assert.equal(status[0].nextScheduledAt, null);
});

test("retry keeps the failed job as history and creates a new queued attempt", async () => {
  const connection = fakeConnection();
  const db = {
    async execute(sql) {
      assert.match(sql, /JOIN website_credentials/);
      return [[{
        job_id: 44,
        website_id: 12,
        source: "ga4",
        report_type: "user_acquisition",
        sync_type: "historical",
        status: "failed",
        requested_start_date: "2025-01-01",
        requested_end_date: "2026-11-17"
      }]];
    },
    async getConnection() { return connection; }
  };

  const retry = await retrySyncJob(44, 3, db);
  assert.deepEqual(retry, { previousJobId: 44, jobId: 55, status: "queued", alreadyQueued: false });
  const insert = connection.calls.find(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO sync_jobs"));
  assert.deepEqual(insert[1], [12, "ga4", "user_acquisition", "historical", "2025-01-01", "2026-11-17"]);
});

test("sync error diagnostics redact OAuth and credential tokens", () => {
  const message = sanitizeSyncError(
    "Request failed Bearer abc123 access_token=secret-value refresh_token: hidden ya29.a0AfH6SMC"
  );
  assert.equal(message.includes("abc123"), false);
  assert.equal(message.includes("secret-value"), false);
  assert.equal(message.includes("hidden"), false);
  assert.equal(message.includes("ya29.a0AfH6SMC"), false);
  assert.match(message, /\[redacted\]/);
});
