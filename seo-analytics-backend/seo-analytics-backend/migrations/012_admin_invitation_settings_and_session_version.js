async function columnExists(pool, tableName, columnName) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

export async function up({ pool }) {
  if (!await columnExists(pool, "organizations", "report_exports_enabled")) {
    await pool.query(
      "ALTER TABLE organizations ADD COLUMN report_exports_enabled BOOLEAN NOT NULL DEFAULT TRUE AFTER status"
    );
  }
  if (!await columnExists(pool, "organizations", "invitation_expiry_hours")) {
    await pool.query(
      "ALTER TABLE organizations ADD COLUMN invitation_expiry_hours SMALLINT UNSIGNED NOT NULL DEFAULT 168 AFTER report_exports_enabled"
    );
  }
  if (!await columnExists(pool, "organization_invitations", "delivery_status")) {
    await pool.query(
      "ALTER TABLE organization_invitations ADD COLUMN delivery_status ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued' AFTER status"
    );
  }
  if (!await columnExists(pool, "organization_invitations", "delivery_error")) {
    await pool.query(
      "ALTER TABLE organization_invitations ADD COLUMN delivery_error VARCHAR(500) NULL AFTER delivery_status"
    );
  }
  if (!await columnExists(pool, "users", "session_version")) {
    await pool.query(
      "ALTER TABLE users ADD COLUMN session_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER display_name"
    );
  }
}

export async function down({ pool }) {
  const [settings] = await pool.query(
    `SELECT COUNT(*) AS count FROM organizations
     WHERE report_exports_enabled <> TRUE OR invitation_expiry_hours <> 168`
  );
  if (Number(settings[0].count) > 0) {
    throw new Error("Rollback refused: organization export or invitation settings have been changed.");
  }

  if (await columnExists(pool, "users", "session_version")) {
    await pool.query("ALTER TABLE users DROP COLUMN session_version");
  }
  if (await columnExists(pool, "organization_invitations", "delivery_status")) {
    await pool.query("ALTER TABLE organization_invitations DROP COLUMN delivery_status");
  }
  if (await columnExists(pool, "organization_invitations", "delivery_error")) {
    await pool.query("ALTER TABLE organization_invitations DROP COLUMN delivery_error");
  }
  if (await columnExists(pool, "organizations", "invitation_expiry_hours")) {
    await pool.query("ALTER TABLE organizations DROP COLUMN invitation_expiry_hours");
  }
  if (await columnExists(pool, "organizations", "report_exports_enabled")) {
    await pool.query("ALTER TABLE organizations DROP COLUMN report_exports_enabled");
  }
}
