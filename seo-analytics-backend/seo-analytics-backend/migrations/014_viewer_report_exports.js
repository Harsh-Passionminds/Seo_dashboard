async function columnExists(pool, columnName) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'organizations'
       AND column_name = ?
     LIMIT 1`,
    [columnName]
  );
  return rows.length > 0;
}

export async function up({ pool }) {
  if (!await columnExists(pool, "viewer_exports_enabled")) {
    await pool.query(
      "ALTER TABLE organizations ADD COLUMN viewer_exports_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER report_exports_enabled"
    );
  }
}

export async function down({ pool }) {
  const [settings] = await pool.query(
    "SELECT COUNT(*) AS enabled_count FROM organizations WHERE viewer_exports_enabled = TRUE"
  );
  if (Number(settings[0].enabled_count) > 0) {
    throw new Error(
      "Rollback refused: viewer export permissions are enabled. Disable them before rollback."
    );
  }
  if (await columnExists(pool, "viewer_exports_enabled")) {
    await pool.query("ALTER TABLE organizations DROP COLUMN viewer_exports_enabled");
  }
}
