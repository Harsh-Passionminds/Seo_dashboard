import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pool } from "./pool.js";
import { env } from "../config/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(here, "../../migrations");
const migrationTable = "schema_migrations";

async function listTables() {
  const [rows] = await pool.query(
    "SELECT TABLE_NAME AS tableName FROM information_schema.tables WHERE table_schema = DATABASE()"
  );
  return rows.map((row) => row.tableName);
}

async function runSqlFile(migrationPath) {
  const sql = (await fs.readFile(migrationPath, "utf8"))
    .replace(/^\s*--.*$/gm, "");
  const statements = sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await pool.query(statement);
  }
  return statements.length;
}

async function runJavaScriptMigration(migrationPath, direction) {
  const migration = await import(pathToFileURL(migrationPath).href);
  const operation = migration[direction];
  if (typeof operation !== "function") {
    throw new Error(`Migration ${path.basename(migrationPath)} does not export ${direction}().`);
  }
  await operation({ pool, env });
}

async function ensureMigrationTable() {
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
  return { tables, applied };
}

async function rollbackMigration(migrationName, applied) {
  if (!migrationName || !/^\d+_[a-z0-9_-]+\.(sql|js)$/i.test(migrationName)) {
    throw new Error("Usage: npm run migrate -- rollback <applied-migration-file>");
  }
  if (!applied.has(migrationName)) {
    throw new Error(`Migration ${migrationName} is not recorded as applied.`);
  }

  const rollbackPath = path.join(migrationDirectory, "rollback", migrationName);
  try {
    await fs.access(rollbackPath);
  } catch {
    throw new Error(`No rollback migration exists for ${migrationName}.`);
  }

  if (migrationName.endsWith(".js")) {
    await runJavaScriptMigration(rollbackPath, "down");
  } else {
    await runSqlFile(rollbackPath);
  }
  await pool.execute(
    `DELETE FROM ${migrationTable} WHERE migration_name = ?`,
    [migrationName]
  );
  console.log(`Rolled back ${migrationName}`);
}

async function migrate() {
  const { tables, applied } = await ensureMigrationTable();
  const applicationTables = tables.filter((table) => table !== migrationTable);
  if (applied.size === 0 && applicationTables.length > 0) {
    throw new Error(
      "The database contains tables but no recorded migrations. Inspect its schema and establish a verified baseline before migrating."
    );
  }

  if (process.argv[2] === "rollback") {
    await rollbackMigration(process.argv[3], applied);
    return;
  }

  const migrationFiles = (await fs.readdir(migrationDirectory))
    .filter((name) => /^\d+_[a-z0-9_-]+\.(sql|js)$/i.test(name))
    .sort();

  for (const migrationName of migrationFiles) {
    if (applied.has(migrationName)) continue;

    const migrationPath = path.join(migrationDirectory, migrationName);
    if (migrationName.endsWith(".js")) {
      await runJavaScriptMigration(migrationPath, "up");
      await pool.execute(
        `INSERT INTO ${migrationTable} (migration_name) VALUES (?)`,
        [migrationName]
      );
      console.log(`Applied ${migrationName}`);
    } else {
      const statementCount = await runSqlFile(migrationPath);
      await pool.execute(
        `INSERT INTO ${migrationTable} (migration_name) VALUES (?)`,
        [migrationName]
      );
      console.log(`Applied ${migrationName} (${statementCount} statements)`);
    }
  }
}

try {
  await migrate();
} catch (error) {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
