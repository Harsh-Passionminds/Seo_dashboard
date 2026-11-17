import crypto from "node:crypto";
import bcrypt from "bcryptjs";

async function columnExists(pool, tableName, columnName) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

export async function up({ pool }) {
  if (!await columnExists(pool, "users", "google_sub")) {
    throw new Error("Migration requires the existing users.google_sub column.");
  }
  await pool.query("ALTER TABLE users MODIFY google_sub VARCHAR(255) NULL");
  await pool.query("ALTER TABLE users MODIFY email VARCHAR(320) NULL");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employee_credentials (
      organization_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      username VARCHAR(50) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
      password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      last_login_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (organization_id, user_id),
      UNIQUE KEY uq_employee_username (username),
      UNIQUE KEY uq_employee_credentials_user (user_id),
      CONSTRAINT fk_employee_credentials_member
        FOREIGN KEY (organization_id, user_id)
        REFERENCES organization_members(organization_id, user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [legacyEmployees] = await pool.query(
    `SELECT m.organization_id, m.user_id, u.email
     FROM organization_members m
     JOIN users u ON u.user_id = m.user_id
     LEFT JOIN employee_credentials ec
       ON ec.organization_id = m.organization_id AND ec.user_id = m.user_id
     WHERE m.role IN ('analyst','viewer') AND m.status IN ('active','inactive')
       AND ec.user_id IS NULL AND u.email IS NOT NULL`
  );
  if (legacyEmployees.length) {
    const unusablePasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 12);
    for (const employee of legacyEmployees) {
      const localPart = String(employee.email).split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "") || "employee";
      const suffix = `-${employee.user_id}`;
      const username = `${localPart.slice(0, 50 - suffix.length)}${suffix}`;
      await pool.execute(
        `INSERT INTO employee_credentials
         (organization_id, user_id, username, password_hash, must_change_password)
         VALUES (?, ?, ?, ?, TRUE)`,
        [employee.organization_id, employee.user_id, username, unusablePasswordHash]
      );
    }
  }
  await pool.query(
    `UPDATE users u
     JOIN organization_members m ON m.user_id = u.user_id
     SET u.session_version = u.session_version + 1
     WHERE m.role IN ('analyst','viewer')`
  );
  await pool.query(
    `UPDATE google_oauth_tokens t
     JOIN organization_members m ON m.user_id = t.user_id
     SET t.is_active = FALSE
     WHERE m.role IN ('analyst','viewer') AND t.is_active = TRUE`
  );
}

export async function down({ pool }) {
  const [rows] = await pool.query("SELECT COUNT(*) AS count FROM employee_credentials");
  if (Number(rows[0].count) > 0) {
    throw new Error("Rollback refused: employee accounts exist. Remove or migrate them before rolling back.");
  }
  await pool.query("DROP TABLE IF EXISTS employee_credentials");
  await pool.query("ALTER TABLE users MODIFY google_sub VARCHAR(255) NOT NULL");
  await pool.query("ALTER TABLE users MODIFY email VARCHAR(320) NOT NULL");
}
