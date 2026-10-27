import { app } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { startSyncWorker, stopSyncWorker } from "./services/sync-worker.js";



const server = app.listen(env.PORT, () => {
  console.log(`SEO Analytics API listening on port ${env.PORT}`);
  startSyncWorker();
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
  stopSyncWorker();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
