export async function ensureBootstrapAdminMembership(db, userId) {
  const [organizations] = await db.execute(
    `SELECT organization_id FROM organizations
     WHERE organization_key = 'shared-default' AND status = 'active' LIMIT 1`
  );
  if (!organizations.length) {
    throw new Error("Cannot bootstrap organization admin: active shared-default organization was not found. Run pending migrations.");
  }

  await db.execute(
    `INSERT INTO organization_members (organization_id, user_id, role, status)
     VALUES (?, ?, 'admin', 'active')
     ON DUPLICATE KEY UPDATE role = 'admin', status = 'active'`,
    [organizations[0].organization_id, userId]
  );
}
