import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(here, "../../migrations");
const migrationTable = "schema_migrations";

async function listTables() {
  const [rows] = await pool.query(
    "SELECT TABLE_NAME AS tableName FROM information_schema.tables WHERE table_schema = DATABASE()"
  );
  return rows.map((row) => row.tableName);
}

try {
  let tables = await listTables();
  if (!tables.includes(migrationTable) && tables.length > 0) {
    throw new Error(
      "The database is not empty and has no migration history. Inspect its schema and establish a verified baseline before migrating."
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${migrationTable} (
      migration_name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (migration_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [appliedRows] = await pool.query(
    `SELECT migration_name FROM ${migrationTable}`
  );
  const applied = new Set(appliedRows.map((row) => row.migration_name));

  tables = await listTables();
  const applicationTables = tables.filter((table) => table !== migrationTable);
  if (applied.size === 0 && applicationTables.length > 0) {
    throw new Error(
      "The database contains tables but no recorded migrations. Inspect its schema and establish a verified baseline before migrating."
    );
  }

  const migrationFiles = (await fs.readdir(migrationDirectory))
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();

  for (const migrationName of migrationFiles) {
    if (applied.has(migrationName)) continue;

    const migrationPath = path.join(migrationDirectory, migrationName);
    const sql = (await fs.readFile(migrationPath, "utf8"))
      .replace(/^\s*--.*$/gm, "");
    const statements = sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await pool.query(statement);
    }
    await pool.execute(
      `INSERT INTO ${migrationTable} (migration_name) VALUES (?)`,
      [migrationName]
    );
    console.log(`Applied ${migrationName} (${statements.length} statements)`);
  }
} catch (error) {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
