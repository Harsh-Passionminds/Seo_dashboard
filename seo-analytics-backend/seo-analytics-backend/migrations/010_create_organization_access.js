async function columnExists(pool, tableName, columnName) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function indexExists(pool, tableName, indexName) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

async function foreignKeyExists(pool, tableName, constraintName) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_schema = DATABASE() AND table_name = ?
       AND constraint_name = ? AND constraint_type = 'FOREIGN KEY' LIMIT 1`,
    [tableName, constraintName]
  );
  return rows.length > 0;
}

async function createTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      organization_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      organization_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      organization_name VARCHAR(255) NOT NULL,
      bootstrap_admin_email VARCHAR(320) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (organization_id),
      UNIQUE KEY uq_organizations_key (organization_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_members (
      organization_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      role ENUM('admin','analyst','viewer') NOT NULL,
      status ENUM('active','inactive','revoked') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (organization_id, user_id),
      KEY idx_org_members_role_status (organization_id, role, status),
      CONSTRAINT fk_org_members_organization FOREIGN KEY (organization_id)
        REFERENCES organizations(organization_id) ON DELETE CASCADE,
      CONSTRAINT fk_org_members_user FOREIGN KEY (user_id)
        REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_invitations (
      invitation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      organization_id BIGINT UNSIGNED NOT NULL,
      email VARCHAR(320) NOT NULL,
      email_normalized VARCHAR(320) NOT NULL,
      role ENUM('admin','analyst','viewer') NOT NULL,
      token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      status ENUM('pending','accepted','revoked','expired') NOT NULL DEFAULT 'pending',
      pending_email VARCHAR(320)
        GENERATED ALWAYS AS (
          CASE WHEN status = 'pending' THEN email_normalized ELSE NULL END
        ) PERSISTENT,
      expires_at DATETIME NOT NULL,
      invited_by_user_id BIGINT UNSIGNED NOT NULL,
      accepted_by_user_id BIGINT UNSIGNED NULL,
      accepted_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (invitation_id),
      UNIQUE KEY uq_org_invitation_token (token_hash),
      UNIQUE KEY uq_org_invitation_identity (organization_id, invitation_id),
      UNIQUE KEY uq_org_pending_invitation (organization_id, pending_email),
      KEY idx_org_invitation_email_status (organization_id, email_normalized, status),
      CONSTRAINT fk_org_invitation_organization FOREIGN KEY (organization_id)
        REFERENCES organizations(organization_id) ON DELETE CASCADE,
      CONSTRAINT fk_org_invitation_inviter FOREIGN KEY (invited_by_user_id)
        REFERENCES users(user_id) ON DELETE RESTRICT,
      CONSTRAINT fk_org_invitation_acceptor FOREIGN KEY (accepted_by_user_id)
        REFERENCES users(user_id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await ensureWebsiteOrganizationColumn(pool);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_invitation_websites (
      organization_id BIGINT UNSIGNED NOT NULL,
      invitation_id BIGINT UNSIGNED NOT NULL,
      website_id BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (organization_id, invitation_id, website_id),
      KEY idx_org_invitation_websites_site (website_id, organization_id),
      CONSTRAINT fk_org_invitation_websites_invitation
        FOREIGN KEY (organization_id, invitation_id)
        REFERENCES organization_invitations(organization_id, invitation_id) ON DELETE CASCADE,
      CONSTRAINT fk_org_invitation_websites_website
        FOREIGN KEY (website_id, organization_id)
        REFERENCES website_credentials(website_id, organization_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS website_permissions (
      organization_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      website_id BIGINT UNSIGNED NOT NULL,
      can_view BOOLEAN NOT NULL DEFAULT TRUE,
      can_manage BOOLEAN NOT NULL DEFAULT FALSE,
      can_manage_keywords BOOLEAN NOT NULL DEFAULT FALSE,
      granted_by_user_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (organization_id, user_id, website_id),
      KEY idx_website_permissions_site (organization_id, website_id, user_id),
      CONSTRAINT fk_website_permissions_member
        FOREIGN KEY (organization_id, user_id)
        REFERENCES organization_members(organization_id, user_id) ON DELETE CASCADE,
      CONSTRAINT fk_website_permissions_website
        FOREIGN KEY (website_id, organization_id)
        REFERENCES website_credentials(website_id, organization_id) ON DELETE CASCADE,
      CONSTRAINT fk_website_permissions_grantor
        FOREIGN KEY (granted_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      activity_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      organization_id BIGINT UNSIGNED NOT NULL,
      actor_user_id BIGINT UNSIGNED NULL,
      target_user_id BIGINT UNSIGNED NULL,
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(100) NOT NULL,
      entity_id VARCHAR(100) NULL,
      details_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (activity_id),
      KEY idx_activity_logs_org_created (organization_id, created_at),
      KEY idx_activity_logs_actor_created (organization_id, actor_user_id, created_at),
      KEY idx_activity_logs_action_created (organization_id, action, created_at),
      CONSTRAINT fk_activity_logs_organization FOREIGN KEY (organization_id)
        REFERENCES organizations(organization_id) ON DELETE CASCADE,
      CONSTRAINT fk_activity_logs_actor FOREIGN KEY (actor_user_id)
        REFERENCES users(user_id) ON DELETE SET NULL,
      CONSTRAINT fk_activity_logs_target FOREIGN KEY (target_user_id)
        REFERENCES users(user_id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureWebsiteOrganizationColumn(pool) {
  if (!await columnExists(pool, "website_credentials", "organization_id")) {
    await pool.query(
      "ALTER TABLE website_credentials ADD COLUMN organization_id BIGINT UNSIGNED NULL AFTER owner_user_id"
    );
  }
  if (!await indexExists(pool, "website_credentials", "uq_website_id_organization")) {
    await pool.query(
      "ALTER TABLE website_credentials ADD UNIQUE KEY uq_website_id_organization (website_id, organization_id)"
    );
  }
  if (!await foreignKeyExists(pool, "website_credentials", "fk_website_organization")) {
    await pool.query(
      `ALTER TABLE website_credentials
       ADD CONSTRAINT fk_website_organization FOREIGN KEY (organization_id)
       REFERENCES organizations(organization_id) ON DELETE RESTRICT`
    );
  }
}

export async function up({ pool, env }) {
  const [users] = await pool.query("SELECT user_id, email FROM users");
  const initialAdminEmail = env.INITIAL_ORG_ADMIN_EMAIL?.trim().toLowerCase() || null;
  const adminMatches = initialAdminEmail
    ? users.filter((user) => String(user.email).trim().toLowerCase() === initialAdminEmail)
    : [];
  if (users.length && adminMatches.length !== 1) {
    throw new Error(
      "Set INITIAL_ORG_ADMIN_EMAIL to the email of exactly one existing user before running this migration."
    );
  }

  await createTables(pool);
  let [organizations] = await pool.execute(
    "SELECT organization_id FROM organizations WHERE organization_key = 'shared-default' LIMIT 1"
  );
  if (!organizations.length) {
    await pool.execute(
      `INSERT INTO organizations (organization_key, organization_name, bootstrap_admin_email)
       VALUES ('shared-default', ?, ?)`,
      [env.ORGANIZATION_NAME, initialAdminEmail]
    );
    [organizations] = await pool.execute(
      "SELECT organization_id FROM organizations WHERE organization_key = 'shared-default' LIMIT 1"
    );
  } else {
    await pool.execute(
      `UPDATE organizations
       SET bootstrap_admin_email = COALESCE(bootstrap_admin_email, ?),
           organization_name = ?
       WHERE organization_id = ?`,
      [initialAdminEmail, env.ORGANIZATION_NAME, organizations[0].organization_id]
    );
  }
  const organizationId = organizations[0].organization_id;

  const [otherOrganizationRows] = await pool.execute(
    `SELECT COUNT(*) AS count FROM website_credentials
     WHERE organization_id IS NOT NULL AND organization_id <> ?`,
    [organizationId]
  );
  if (Number(otherOrganizationRows[0].count) > 0) {
    throw new Error("Existing websites are already assigned to a different organization; refusing to reassign them.");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const user of users) {
      const role = String(user.email).trim().toLowerCase() === initialAdminEmail ? "admin" : "viewer";
      await connection.execute(
        `INSERT INTO organization_members (organization_id, user_id, role, status)
         VALUES (?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE role = VALUES(role), status = 'active'`,
        [organizationId, user.user_id, role]
      );
    }

    await connection.execute(
      `UPDATE website_credentials SET organization_id = ?
       WHERE organization_id IS NULL`,
      [organizationId]
    );
    await connection.execute(
      `INSERT IGNORE INTO website_permissions
       (organization_id, user_id, website_id, can_view, can_manage, can_manage_keywords)
       SELECT organization_id, owner_user_id, website_id, TRUE, FALSE, FALSE
       FROM website_credentials
       WHERE organization_id = ?`,
      [organizationId]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const [unassigned] = await pool.execute(
    "SELECT COUNT(*) AS count FROM website_credentials WHERE organization_id IS NULL"
  );
  if (Number(unassigned[0].count) > 0) {
    throw new Error("Some websites could not be assigned to the shared organization.");
  }
  const [column] = await pool.execute(
    `SELECT IS_NULLABLE AS nullable FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'website_credentials'
       AND column_name = 'organization_id' LIMIT 1`
  );
  if (column[0]?.nullable === "YES") {
    await pool.query(
      "ALTER TABLE website_credentials MODIFY COLUMN organization_id BIGINT UNSIGNED NOT NULL"
    );
  }
}

export async function down({ pool, env }) {
  const [organizations] = await pool.execute(
    "SELECT organization_id FROM organizations WHERE organization_key = 'shared-default' LIMIT 1"
  );
  if (!organizations.length) return;
  const organizationId = organizations[0].organization_id;

  const [dependent] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM organization_invitations WHERE organization_id = ?) AS invitations,
       (SELECT COUNT(*) FROM activity_logs WHERE organization_id = ?) AS activityLogs,
       (SELECT COUNT(*) FROM organization_members WHERE organization_id = ?) AS members,
       (SELECT COUNT(*) FROM users) AS users`,
    [organizationId, organizationId, organizationId]
  );
  const adminEmail = env.INITIAL_ORG_ADMIN_EMAIL?.trim().toLowerCase() || null;
  if (Number(dependent[0].users) > 0 && !adminEmail) {
    throw new Error("Set INITIAL_ORG_ADMIN_EMAIL to safely verify organization membership before rollback.");
  }
  const [changedMembers] = await pool.execute(
    `SELECT COUNT(*) AS count
     FROM organization_members m
     LEFT JOIN users u ON u.user_id = m.user_id
     WHERE m.organization_id = ?
       AND (u.user_id IS NULL OR m.status <> 'active'
         OR m.role <> CASE WHEN LOWER(u.email) = ? THEN 'admin' ELSE 'viewer' END)`,
    [organizationId, adminEmail]
  );
  if (
    Number(dependent[0].invitations) > 0 ||
    Number(dependent[0].activityLogs) > 0 ||
    Number(dependent[0].members) !== Number(dependent[0].users) ||
    Number(changedMembers[0].count) > 0
  ) {
    throw new Error(
      "Rollback refused: organization invitations, audit records, or post-migration membership data exist. Preserve/export them before rollback."
    );
  }

  const [permissionChanges] = await pool.execute(
    `SELECT COUNT(*) AS count
     FROM website_permissions p
     LEFT JOIN website_credentials w
       ON w.website_id = p.website_id AND w.organization_id = p.organization_id
     WHERE p.organization_id = ?
       AND (w.website_id IS NULL OR p.user_id <> w.owner_user_id
         OR p.can_view <> TRUE OR p.can_manage <> FALSE OR p.can_manage_keywords <> FALSE)`,
    [organizationId]
  );
  const [permissionTotals] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM website_credentials WHERE organization_id = ?) AS websites,
       (SELECT COUNT(*) FROM website_permissions WHERE organization_id = ?) AS permissions`,
    [organizationId, organizationId]
  );
  if (
    Number(permissionChanges[0].count) > 0 ||
    Number(permissionTotals[0].websites) !== Number(permissionTotals[0].permissions)
  ) {
    throw new Error(
      "Rollback refused: website grants changed since migration. Restore the original grants before rollback."
    );
  }

  await pool.query("DROP TABLE IF EXISTS organization_invitation_websites");
  await pool.query("DROP TABLE IF EXISTS organization_invitations");
  await pool.query("DROP TABLE IF EXISTS activity_logs");
  await pool.query("DROP TABLE IF EXISTS website_permissions");
  await pool.query("DROP TABLE IF EXISTS organization_members");

  if (await foreignKeyExists(pool, "website_credentials", "fk_website_organization")) {
    await pool.query(
      "ALTER TABLE website_credentials DROP FOREIGN KEY fk_website_organization"
    );
  }
  if (await indexExists(pool, "website_credentials", "uq_website_id_organization")) {
    await pool.query(
      "ALTER TABLE website_credentials DROP INDEX uq_website_id_organization"
    );
  }
  if (await columnExists(pool, "website_credentials", "organization_id")) {
    await pool.query(
      "ALTER TABLE website_credentials DROP COLUMN organization_id"
    );
  }
  await pool.query("DROP TABLE IF EXISTS organizations");
}
