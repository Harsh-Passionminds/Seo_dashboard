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

async function addColumn(pool, tableName, columnName, definition) {
  if (!await columnExists(pool, tableName, columnName)) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function renameColumn(pool, tableName, oldName, newName, definition) {
  const hasOld = await columnExists(pool, tableName, oldName);
  const hasNew = await columnExists(pool, tableName, newName);
  if (hasOld && hasNew) {
    throw new Error(`Both ${tableName}.${oldName} and ${tableName}.${newName} exist; refusing an ambiguous rename.`);
  }
  if (hasOld) {
    await pool.query(
      `ALTER TABLE ${tableName} CHANGE COLUMN ${oldName} ${newName} ${definition}`
    );
  }
}

async function addIndex(pool, tableName, indexName, definition) {
  if (!await indexExists(pool, tableName, indexName)) {
    await pool.query(`ALTER TABLE ${tableName} ADD ${definition}`);
  }
}

async function dropIndex(pool, tableName, indexName) {
  if (await indexExists(pool, tableName, indexName)) {
    await pool.query(`ALTER TABLE ${tableName} DROP INDEX ${indexName}`);
  }
}

async function addForeignKey(pool, tableName, constraintName, definition) {
  if (!await foreignKeyExists(pool, tableName, constraintName)) {
    await pool.query(
      `ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${definition}`
    );
  }
}

async function dropForeignKey(pool, tableName, constraintName) {
  if (await foreignKeyExists(pool, tableName, constraintName)) {
    await pool.query(`ALTER TABLE ${tableName} DROP FOREIGN KEY ${constraintName}`);
  }
}

export async function up({ pool }) {
  await addColumn(pool, "organizations", "default_timezone", "VARCHAR(64) NOT NULL DEFAULT 'UTC' AFTER organization_name");
  await addColumn(pool, "organizations", "status", "ENUM('active','inactive') NOT NULL DEFAULT 'active' AFTER default_timezone");

  await addColumn(pool, "organization_members", "membership_id", "BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE FIRST");
  await addColumn(pool, "organization_members", "joined_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER status");

  await renameColumn(
    pool,
    "organization_invitations",
    "token_hash",
    "invitation_token_hash",
    "CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL"
  );

  await addColumn(pool, "website_permissions", "permission_id", "BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE FIRST");
  await dropForeignKey(pool, "website_permissions", "fk_website_permissions_grantor");
  await renameColumn(
    pool,
    "website_permissions",
    "granted_by_user_id",
    "assigned_by_user_id",
    "BIGINT UNSIGNED NULL"
  );
  await addForeignKey(
    pool,
    "website_permissions",
    "fk_website_permissions_assigner",
    "FOREIGN KEY (assigned_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL"
  );

  await renameColumn(pool, "activity_logs", "entity_type", "resource_type", "VARCHAR(100) NOT NULL");
  await renameColumn(pool, "activity_logs", "entity_id", "resource_id", "VARCHAR(100) NULL");
  await renameColumn(pool, "activity_logs", "details_json", "metadata", "JSON NULL");

  await addIndex(
    pool,
    "website_credentials",
    "idx_website_org_active_name",
    "KEY idx_website_org_active_name (organization_id, is_active, website_name)"
  );

  // uq_tracked_keyword_website already starts with website_id, so this index is redundant.
  await dropIndex(pool, "tracked_keywords", "idx_tracked_keywords_website");
}

export async function down({ pool }) {
  const [organizations] = await pool.query(
    "SELECT COUNT(*) AS count FROM organizations WHERE default_timezone <> 'UTC' OR status <> 'active'"
  );
  if (Number(organizations[0].count) > 0) {
    throw new Error("Rollback refused: organization settings have changed from migration defaults.");
  }

  await addIndex(
    pool,
    "tracked_keywords",
    "idx_tracked_keywords_website",
    "KEY idx_tracked_keywords_website (website_id)"
  );
  await dropIndex(pool, "website_credentials", "idx_website_org_active_name");

  await renameColumn(pool, "activity_logs", "metadata", "details_json", "JSON NULL");
  await renameColumn(pool, "activity_logs", "resource_id", "entity_id", "VARCHAR(100) NULL");
  await renameColumn(pool, "activity_logs", "resource_type", "entity_type", "VARCHAR(100) NOT NULL");

  await dropForeignKey(pool, "website_permissions", "fk_website_permissions_assigner");
  await renameColumn(
    pool,
    "website_permissions",
    "assigned_by_user_id",
    "granted_by_user_id",
    "BIGINT UNSIGNED NULL"
  );
  await addForeignKey(
    pool,
    "website_permissions",
    "fk_website_permissions_grantor",
    "FOREIGN KEY (granted_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL"
  );

  await renameColumn(
    pool,
    "organization_invitations",
    "invitation_token_hash",
    "token_hash",
    "CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL"
  );

  await pool.query("ALTER TABLE organization_members DROP COLUMN joined_at");
  await pool.query("ALTER TABLE organization_members DROP COLUMN membership_id");
  await pool.query("ALTER TABLE website_permissions DROP COLUMN permission_id");

  await pool.query("ALTER TABLE organizations DROP COLUMN status");
  await pool.query("ALTER TABLE organizations DROP COLUMN default_timezone");
}
