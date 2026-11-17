async function columnExists(pool, tableName, columnName) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

export async function up({ pool }) {
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
}

export async function down({ pool }) {
  if (await columnExists(pool, "organization_invitations", "delivery_error")) {
    await pool.query("ALTER TABLE organization_invitations DROP COLUMN delivery_error");
  }
  if (await columnExists(pool, "organization_invitations", "delivery_status")) {
    await pool.query("ALTER TABLE organization_invitations DROP COLUMN delivery_status");
  }
}
