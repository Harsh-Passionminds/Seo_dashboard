import crypto from "node:crypto";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { sendInvitationEmail } from "./invitation-mailer.service.js";
import { HttpError } from "../utils/http-error.js";
import { createTemporaryPassword, hashPassword } from "./password.service.js";

const MEMBER_ROLES = new Set(["admin", "analyst", "viewer"]);
const MEMBER_STATUSES = new Set(["active", "inactive"]);

function assertRole(role) {
  if (!MEMBER_ROLES.has(role)) {
    throw new HttpError(422, "role must be admin, analyst, or viewer.", "VALIDATION_ERROR");
  }
}

function assertMemberStatus(status) {
  if (!MEMBER_STATUSES.has(status)) {
    throw new HttpError(422, "status must be active or inactive.", "VALIDATION_ERROR");
  }
}

function assertId(id, label) {
  const parsed = Number(id);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${label} must be a positive integer.`, "INVALID_ID");
  }
  return parsed;
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function invitationTokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getDeliveryDiagnostic(error) {
  const redactSecret = (message, secret) => {
    if (!secret) return message;
    return message.replaceAll(secret, "[redacted]");
  };
  let message = typeof error?.message === "string" ? error.message : "";
  message = redactSecret(message, env.SMTP_USER);
  message = redactSecret(message, env.SMTP_PASSWORD)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b(password|passwd|token|secret|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[redacted]")
    .slice(0, 240);

  const code = typeof error?.code === "string"
    ? error.code.replace(/[^A-Z0-9_-]/gi, "").slice(0, 40)
    : "UNKNOWN";
  const responseCode = Number.isInteger(error?.responseCode) ? error.responseCode : null;
  const name = typeof error?.name === "string"
    ? error.name.replace(/[^A-Z0-9_-]/gi, "").slice(0, 40)
    : null;
  const command = typeof error?.command === "string"
    ? error.command.replace(/[^A-Z0-9_-]/gi, "").slice(0, 40)
    : null;

  return { code, responseCode, name, command, message: message || null };
}

function createInvitationToken() {
  return crypto.randomBytes(32).toString("base64url");
}

async function withTransaction(db, callback) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function writeActivity(db, {
  organizationId,
  actorUserId,
  targetUserId = null,
  action,
  resourceType,
  resourceId = null,
  metadata = null
}) {
  await db.execute(
    `INSERT INTO activity_logs
     (organization_id, actor_user_id, target_user_id, action, resource_type, resource_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      organizationId,
      actorUserId,
      targetUserId,
      action,
      resourceType,
      resourceId === null ? null : String(resourceId),
      metadata === null ? null : JSON.stringify(metadata)
    ]
  );
}

async function requireOrganizationMember(db, organizationId, userId, { lock = false } = {}) {
  const [rows] = await db.execute(
    `SELECT m.user_id, m.role, m.status, u.email, u.display_name
     FROM organization_members m
     JOIN users u ON u.user_id = m.user_id
     WHERE m.organization_id = ? AND m.user_id = ?${lock ? " FOR UPDATE" : ""}`,
    [organizationId, userId]
  );
  if (!rows.length) throw new HttpError(404, "Organization member not found.", "MEMBER_NOT_FOUND");
  return rows[0];
}

async function assertNotLastAdmin(db, organizationId, member, newRole, newStatus) {
  const losesAdmin = member.role === "admin" &&
    (newRole !== "admin" || (newStatus !== undefined && newStatus !== "active"));
  if (!losesAdmin) return;
  const [rows] = await db.execute(
    `SELECT user_id FROM organization_members
     WHERE organization_id = ? AND role = 'admin' AND status = 'active'
     FOR UPDATE`,
    [organizationId]
  );
  if (rows.length <= 1) {
    throw new HttpError(409, "The last active organization Admin cannot be demoted or deactivated.", "LAST_ACTIVE_ADMIN");
  }
}

function normalizeMember(row) {
  return {
    id: Number(row.user_id),
    name: row.display_name,
    email: row.email,
    username: row.username || null,
    isEmployeeAccount: Boolean(row.username),
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at,
    lastLoginAt: row.last_login_at || null,
    assignedWebsiteIds: row.assigned_website_ids
      ? String(row.assigned_website_ids).split(",").map(Number)
      : []
  };
}

export function createAdminService({
  db = pool,
  deliverInvitation = sendInvitationEmail,
  isSmtpConfigured = () => env.smtpConfigured,
  logDeliveryFailure = (diagnostic) => console.error("Invitation email delivery failed:", diagnostic),
  now = () => new Date()
} = {}) {
  async function getOverview(organizationId) {
    const [[memberCounts]] = await db.execute(
      `SELECT COUNT(*) AS totalMembers,
         SUM(status = 'active') AS activeMembers,
         SUM(status = 'inactive') AS inactiveMembers
       FROM organization_members WHERE organization_id = ?`,
      [organizationId]
    );
    const [[invitationCounts]] = await db.execute(
      `SELECT COUNT(*) AS pendingInvitations FROM organization_invitations
       WHERE organization_id = ? AND status = 'pending' AND expires_at > NOW()`,
      [organizationId]
    );
    const [[websiteCounts]] = await db.execute(
      "SELECT COUNT(*) AS totalWebsites FROM website_credentials WHERE organization_id = ?",
      [organizationId]
    );
    const [[integrationCounts]] = await db.execute(
      `SELECT COUNT(DISTINCT t.token_id) AS connectedIntegrations
       FROM google_oauth_tokens t
       JOIN organization_members m ON m.user_id = t.user_id
       WHERE m.organization_id = ? AND m.status = 'active' AND t.is_active = TRUE`,
      [organizationId]
    );
    const [recentActivities] = await db.execute(
      `SELECT a.activity_id, a.actor_user_id, actor.display_name AS actor_name,
              a.action, a.resource_type, a.resource_id, a.metadata, a.created_at
       FROM activity_logs a
       LEFT JOIN users actor ON actor.user_id = a.actor_user_id
       WHERE a.organization_id = ? ORDER BY a.activity_id DESC LIMIT 10`,
      [organizationId]
    );
    const [latestSync] = await db.execute(
      `SELECT j.job_id, j.website_id, w.website_name, j.source, j.report_type,
              j.status, j.rows_fetched, j.error_message, j.created_at, j.completed_at
       FROM sync_jobs j
       JOIN website_credentials w ON w.website_id = j.website_id
       WHERE w.organization_id = ? ORDER BY j.job_id DESC LIMIT 1`,
      [organizationId]
    );
    return {
      members: {
        total: Number(memberCounts.totalMembers || 0),
        active: Number(memberCounts.activeMembers || 0),
        inactive: Number(memberCounts.inactiveMembers || 0)
      },
      pendingInvitations: Number(invitationCounts.pendingInvitations || 0),
      totalWebsites: Number(websiteCounts.totalWebsites || 0),
      connectedGoogleIntegrations: Number(integrationCounts.connectedIntegrations || 0),
      recentActivities,
      latestSynchronization: latestSync[0] || null
    };
  }

  async function listMembers(organizationId, {
    search = "",
    role = "",
    status = "",
    page = 1,
    limit = 20,
    sortBy = "joined_at",
    order = "desc"
  }) {
    const sortColumns = {
      name: "u.display_name",
      email: "COALESCE(ec.username, u.email)",
      role: "m.role",
      status: "m.status",
      joined_at: "m.joined_at"
    };
    const conditions = ["m.organization_id = ?"];
    const parameters = [organizationId];
    if (search) {
      conditions.push("(u.display_name LIKE ? ESCAPE '\\\\' OR u.email LIKE ? ESCAPE '\\\\' OR ec.username LIKE ? ESCAPE '\\\\')");
      const like = `%${escapeLike(search)}%`;
      parameters.push(like, like, like);
    }
    if (role) {
      conditions.push("m.role = ?");
      parameters.push(role);
    }
    if (status) {
      conditions.push("m.status = ?");
      parameters.push(status);
    }
    const where = conditions.join(" AND ");
    const [[totalRow]] = await db.execute(
      `SELECT COUNT(*) AS total FROM organization_members m
       JOIN users u ON u.user_id = m.user_id
       LEFT JOIN employee_credentials ec
         ON ec.organization_id = m.organization_id AND ec.user_id = m.user_id
       WHERE ${where}`,
      parameters
    );
    const offset = (page - 1) * limit;
    const [rows] = await db.execute(
      `SELECT u.user_id, u.display_name, u.email, ec.username, ec.last_login_at,
              m.role, m.status, m.joined_at,
              GROUP_CONCAT(DISTINCT p.website_id ORDER BY p.website_id) AS assigned_website_ids
       FROM organization_members m
       JOIN users u ON u.user_id = m.user_id
       LEFT JOIN employee_credentials ec
         ON ec.organization_id = m.organization_id AND ec.user_id = m.user_id
       LEFT JOIN website_permissions p
         ON p.organization_id = m.organization_id AND p.user_id = m.user_id AND p.can_view = TRUE
       WHERE ${where}
       GROUP BY u.user_id, u.display_name, u.email, ec.username, ec.last_login_at,
                m.role, m.status, m.joined_at
       ORDER BY ${sortColumns[sortBy]} ${order === "asc" ? "ASC" : "DESC"}, u.user_id ASC
       LIMIT ? OFFSET ?`,
      [...parameters, limit, offset]
    );
    return {
      data: rows.map(normalizeMember),
      pagination: { page, limit, total: Number(totalRow.total) }
    };
  }

  async function getMember(organizationId, targetUserId) {
    const [rows] = await db.execute(
      `SELECT u.user_id, u.display_name, u.email, ec.username, ec.last_login_at,
              m.role, m.status, m.joined_at,
              GROUP_CONCAT(DISTINCT p.website_id ORDER BY p.website_id) AS assigned_website_ids
       FROM organization_members m
       JOIN users u ON u.user_id = m.user_id
       LEFT JOIN employee_credentials ec
         ON ec.organization_id = m.organization_id AND ec.user_id = m.user_id
       LEFT JOIN website_permissions p
         ON p.organization_id = m.organization_id AND p.user_id = m.user_id AND p.can_view = TRUE
       WHERE m.organization_id = ? AND m.user_id = ?
       GROUP BY u.user_id, u.display_name, u.email, ec.username, ec.last_login_at,
                m.role, m.status, m.joined_at`,
      [organizationId, assertId(targetUserId, "userId")]
    );
    if (!rows.length) throw new HttpError(404, "Organization member not found.", "MEMBER_NOT_FOUND");
    return normalizeMember(rows[0]);
  }

  async function createEmployee(organizationId, actorUserId, {
    name,
    username,
    password,
    role,
    websiteIds
  }) {
    if (!["analyst", "viewer"].includes(role)) {
      throw new HttpError(422, "Employee role must be analyst or viewer.", "VALIDATION_ERROR");
    }
    const normalizedUsername = username.trim().toLowerCase();
    const temporaryPassword = password ? null : createTemporaryPassword();
    const passwordHash = await hashPassword(password || temporaryPassword);
    const uniqueIds = [...new Set(websiteIds.map((id) => assertId(id, "websiteId")))];
    if (uniqueIds.length !== websiteIds.length) {
      throw new HttpError(422, "websiteIds must not contain duplicates.", "VALIDATION_ERROR");
    }
    const userId = await withTransaction(db, async (connection) => {
      const [sites] = uniqueIds.length
        ? await connection.query(
            `SELECT website_id FROM website_credentials
             WHERE organization_id = ? AND is_active = TRUE
               AND website_id IN (${uniqueIds.map(() => "?").join(",")})`,
            [organizationId, ...uniqueIds]
          )
        : [[]];
      if (sites.length !== uniqueIds.length) {
        throw new HttpError(404, "One or more websites do not belong to this organization.", "WEBSITE_NOT_FOUND");
      }
      const [userResult] = await connection.execute(
        "INSERT INTO users (google_sub, email, display_name) VALUES (NULL, NULL, ?)",
        [name.trim()]
      );
      const employeeId = Number(userResult.insertId);
      await connection.execute(
        `INSERT INTO organization_members (organization_id, user_id, role, status, joined_at)
         VALUES (?, ?, ?, 'active', NOW())`,
        [organizationId, employeeId, role]
      );
      await connection.execute(
        `INSERT INTO employee_credentials
         (organization_id, user_id, username, password_hash, must_change_password)
         VALUES (?, ?, ?, ?, ?)`,
        [organizationId, employeeId, normalizedUsername, passwordHash, Boolean(temporaryPassword)]
      );
      for (const websiteId of uniqueIds) {
        await connection.execute(
          `INSERT INTO website_permissions
           (organization_id, user_id, website_id, can_view, can_manage, can_manage_keywords, assigned_by_user_id)
           VALUES (?, ?, ?, TRUE, FALSE, FALSE, ?)`,
          [organizationId, employeeId, websiteId, actorUserId]
        );
      }
      await writeActivity(connection, {
        organizationId,
        actorUserId,
        targetUserId: employeeId,
        action: "employee.account_created",
        resourceType: "organization_member",
        resourceId: employeeId,
        metadata: { username: normalizedUsername, role, websiteIds: uniqueIds, temporaryPassword: Boolean(temporaryPassword) }
      });
      return employeeId;
    }).catch((error) => {
      if (error.code === "ER_DUP_ENTRY") {
        throw new HttpError(409, "That username is already in use in this organization.", "USERNAME_ALREADY_EXISTS");
      }
      throw error;
    });
    const member = await getMember(organizationId, userId);
    return temporaryPassword ? { ...member, temporaryPassword } : member;
  }

  async function resetEmployeePassword(organizationId, actorUserId, targetUserId) {
    const targetId = assertId(targetUserId, "userId");
    const temporaryPassword = createTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    await withTransaction(db, async (connection) => {
      await requireOrganizationMember(connection, organizationId, targetId, { lock: true });
      const [result] = await connection.execute(
        `UPDATE employee_credentials
         SET password_hash = ?, must_change_password = TRUE
         WHERE organization_id = ? AND user_id = ?`,
        [passwordHash, organizationId, targetId]
      );
      if (!result.affectedRows) throw new HttpError(409, "This account does not use employee password login.", "EMPLOYEE_ACCOUNT_REQUIRED");
      await connection.execute(
        "UPDATE users SET session_version = session_version + 1 WHERE user_id = ?",
        [targetId]
      );
      await writeActivity(connection, {
        organizationId,
        actorUserId,
        targetUserId: targetId,
        action: "employee.password_reset",
        resourceType: "organization_member",
        resourceId: targetId,
        metadata: { temporaryPassword: true }
      });
    });
    return { userId: targetId, temporaryPassword };
  }

  async function changeMemberRole(organizationId, actorUserId, targetUserId, role) {
    assertRole(role);
    const targetId = assertId(targetUserId, "userId");
    await withTransaction(db, async (connection) => {
      const member = await requireOrganizationMember(connection, organizationId, targetId, { lock: true });
      await assertNotLastAdmin(connection, organizationId, member, role);
      const [employeeAccounts] = await connection.execute(
        "SELECT user_id FROM employee_credentials WHERE organization_id = ? AND user_id = ?",
        [organizationId, targetId]
      );
      if (employeeAccounts.length && role === "admin") {
        throw new HttpError(409, "Employee password accounts cannot be promoted to Admin; Admins must authenticate with Google.", "GOOGLE_ADMIN_REQUIRED");
      }
      if (!employeeAccounts.length && role !== "admin") {
        throw new HttpError(409, "This account does not have employee username/password credentials.", "EMPLOYEE_ACCOUNT_REQUIRED");
      }
      if (member.role !== role) {
        await connection.execute(
          "UPDATE organization_members SET role = ? WHERE organization_id = ? AND user_id = ?",
          [role, organizationId, targetId]
        );
        await connection.execute(
          `UPDATE website_permissions SET can_manage = ?, can_manage_keywords = ?
           WHERE organization_id = ? AND user_id = ?`,
          [role === "admin", role === "admin", organizationId, targetId]
        );
        await writeActivity(connection, {
          organizationId,
          actorUserId,
          targetUserId: targetId,
          action: "member.role_changed",
          resourceType: "organization_member",
          resourceId: targetId,
          metadata: { previousRole: member.role, newRole: role }
        });
      }
    });
    return getMember(organizationId, targetId);
  }

  async function changeMemberStatus(organizationId, actorUserId, targetUserId, status) {
    assertMemberStatus(status);
    const targetId = assertId(targetUserId, "userId");
    await withTransaction(db, async (connection) => {
      const member = await requireOrganizationMember(connection, organizationId, targetId, { lock: true });
      await assertNotLastAdmin(connection, organizationId, member, member.role, status);
      if (member.status !== status) {
        await connection.execute(
          "UPDATE organization_members SET status = ? WHERE organization_id = ? AND user_id = ?",
          [status, organizationId, targetId]
        );
        if (status !== "active") {
          await connection.execute(
            "UPDATE users SET session_version = session_version + 1 WHERE user_id = ?",
            [targetId]
          );
        }
        await writeActivity(connection, {
          organizationId,
          actorUserId,
          targetUserId: targetId,
          action: "member.status_changed",
          resourceType: "organization_member",
          resourceId: targetId,
          metadata: { previousStatus: member.status, newStatus: status }
        });
      }
    });
    return getMember(organizationId, targetId);
  }

  async function revokeMember(organizationId, actorUserId, targetUserId) {
    const targetId = assertId(targetUserId, "userId");
    await withTransaction(db, async (connection) => {
      const member = await requireOrganizationMember(connection, organizationId, targetId, { lock: true });
      await assertNotLastAdmin(connection, organizationId, member, null, "revoked");
      await connection.execute(
        "UPDATE organization_members SET status = 'revoked' WHERE organization_id = ? AND user_id = ?",
        [organizationId, targetId]
      );
      await connection.execute("DELETE FROM website_permissions WHERE organization_id = ? AND user_id = ?", [organizationId, targetId]);
      await connection.execute("UPDATE users SET session_version = session_version + 1 WHERE user_id = ?", [targetId]);
      await writeActivity(connection, {
        organizationId,
        actorUserId,
        targetUserId: targetId,
        action: "member.access_revoked",
        resourceType: "organization_member",
        resourceId: targetId,
        metadata: { previousStatus: member.status, newStatus: "revoked" }
      });
    });
    return { userId: targetId, status: "revoked" };
  }

  async function getWebsiteAccess(organizationId, targetUserId) {
    const targetId = assertId(targetUserId, "userId");
    await requireOrganizationMember(db, organizationId, targetId);
    const [rows] = await db.execute(
      `SELECT w.website_id, w.website_name, w.domain_name, w.is_active,
              (p.website_id IS NOT NULL AND p.can_view = TRUE) AS can_view,
              COALESCE(p.can_manage, FALSE) AS can_manage,
              COALESCE(p.can_manage_keywords, FALSE) AS can_manage_keywords
       FROM website_credentials w
       LEFT JOIN website_permissions p
         ON p.organization_id = w.organization_id AND p.website_id = w.website_id AND p.user_id = ?
       WHERE w.organization_id = ? ORDER BY w.website_name, w.website_id`,
      [targetId, organizationId]
    );
    return {
      userId: targetId,
      websites: rows.map((row) => ({
        websiteId: Number(row.website_id),
        websiteName: row.website_name,
        domainName: row.domain_name,
        active: Boolean(row.is_active),
        canView: Boolean(row.can_view),
        canManage: Boolean(row.can_manage),
        canManageKeywords: Boolean(row.can_manage_keywords)
      }))
    };
  }

  async function replaceWebsiteAccess(organizationId, actorUserId, targetUserId, websiteIds) {
    const targetId = assertId(targetUserId, "userId");
    const uniqueIds = [...new Set(websiteIds.map((id) => assertId(id, "websiteId")))];
    if (uniqueIds.length !== websiteIds.length) {
      throw new HttpError(422, "websiteIds must not contain duplicates.", "VALIDATION_ERROR");
    }
    await withTransaction(db, async (connection) => {
      const member = await requireOrganizationMember(connection, organizationId, targetId, { lock: true });
      const [sites] = uniqueIds.length
        ? await connection.query(
            `SELECT website_id FROM website_credentials
             WHERE organization_id = ? AND website_id IN (${uniqueIds.map(() => "?").join(",")})`,
            [organizationId, ...uniqueIds]
          )
        : [[]];
      if (sites.length !== uniqueIds.length) {
        throw new HttpError(404, "One or more websites do not belong to this organization.", "WEBSITE_NOT_FOUND");
      }
      const [oldRows] = await connection.execute(
        `SELECT website_id FROM website_permissions
         WHERE organization_id = ? AND user_id = ? AND can_view = TRUE`,
        [organizationId, targetId]
      );
      const oldIds = oldRows.map((row) => Number(row.website_id)).sort((a, b) => a - b);
      const newIds = [...uniqueIds].sort((a, b) => a - b);
      const grantsChanged = oldIds.length !== newIds.length || oldIds.some((id, i) => id !== newIds[i]);
      await connection.execute(
        "DELETE FROM website_permissions WHERE organization_id = ? AND user_id = ?",
        [organizationId, targetId]
      );
      const canManage = member.role === "admin";
      for (const websiteId of uniqueIds) {
        await connection.execute(
          `INSERT INTO website_permissions
           (organization_id, user_id, website_id, can_view, can_manage, can_manage_keywords, assigned_by_user_id)
           VALUES (?, ?, ?, TRUE, ?, ?, ?)`,
          [organizationId, targetId, websiteId, canManage, canManage, actorUserId]
        );
      }
      if (grantsChanged) {
        await writeActivity(connection, {
          organizationId,
          actorUserId,
          targetUserId: targetId,
          action: "member.website_access_changed",
          resourceType: "website_permission",
          resourceId: targetId,
          metadata: { previousWebsiteIds: oldIds, websiteIds: newIds }
        });
      }
    });
    return getWebsiteAccess(organizationId, targetId);
  }

  async function listWebsites(organizationId) {
    const [rows] = await db.execute(
      `SELECT w.website_id, w.website_name, w.domain_name, w.ga4_property_id,
              w.gsc_property_url, w.timezone, w.currency_code, w.is_active,
              w.owner_user_id, owner.email AS owner_email,
              COUNT(DISTINCT CASE WHEN j.status IN ('queued','running') THEN j.job_id END) AS active_sync_jobs
       FROM website_credentials w
       JOIN users owner ON owner.user_id = w.owner_user_id
       LEFT JOIN sync_jobs j ON j.website_id = w.website_id
       WHERE w.organization_id = ?
       GROUP BY w.website_id, w.website_name, w.domain_name, w.ga4_property_id,
                w.gsc_property_url, w.timezone, w.currency_code, w.is_active,
                w.owner_user_id, owner.email
       ORDER BY w.website_name`,
      [organizationId]
    );
    return rows;
  }

  async function listInvitations(organizationId, { status = "", page = 1, limit = 20 }) {
    await db.execute(
      `UPDATE organization_invitations SET status = 'expired'
       WHERE organization_id = ? AND status = 'pending' AND expires_at <= NOW()`,
      [organizationId]
    );
    const conditions = ["organization_id = ?"];
    const params = [organizationId];
    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    const where = conditions.join(" AND ");
    const [[total]] = await db.execute(
      `SELECT COUNT(*) AS total FROM organization_invitations WHERE ${where}`,
      params
    );
    const [rows] = await db.execute(
      `SELECT invitation_id, email, role, status, delivery_status, delivery_error,
              expires_at, invited_by_user_id, accepted_by_user_id, accepted_at, created_at
       FROM organization_invitations WHERE ${where}
       ORDER BY invitation_id DESC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    );
    const ids = rows.map((row) => row.invitation_id);
    const websiteIdsByInvitation = new Map(ids.map((id) => [Number(id), []]));
    if (ids.length) {
      const [assignments] = await db.query(
        `SELECT invitation_id, website_id FROM organization_invitation_websites
         WHERE organization_id = ? AND invitation_id IN (${ids.map(() => "?").join(",")})
         ORDER BY website_id`,
        [organizationId, ...ids]
      );
      for (const assignment of assignments) {
        websiteIdsByInvitation.get(Number(assignment.invitation_id))?.push(Number(assignment.website_id));
      }
    }
    return {
      data: rows.map((row) => ({
        id: Number(row.invitation_id),
        email: row.email,
        role: row.role,
        status: row.status === "pending" && new Date(row.expires_at) <= now() ? "expired" : row.status,
        deliveryStatus: row.delivery_status,
        deliveryError: row.delivery_error,
        expiresAt: row.expires_at,
        invitedBy: Number(row.invited_by_user_id),
        acceptedBy: row.accepted_by_user_id === null ? null : Number(row.accepted_by_user_id),
        acceptedAt: row.accepted_at,
        createdAt: row.created_at,
        websiteIds: websiteIdsByInvitation.get(Number(row.invitation_id)) || []
      })),
      pagination: { page, limit, total: Number(total.total) }
    };
  }

  async function getInvitation(organizationId, invitationId) {
    const id = assertId(invitationId, "invitationId");
    const [rows] = await db.execute(
      `SELECT invitation_id, email, role, status, delivery_status, delivery_error,
              expires_at, invited_by_user_id, accepted_by_user_id, accepted_at, created_at
       FROM organization_invitations WHERE organization_id = ? AND invitation_id = ?`,
      [organizationId, id]
    );
    if (!rows.length) throw new HttpError(404, "Invitation not found.", "INVITATION_NOT_FOUND");
    const [[websites]] = await db.execute(
      `SELECT GROUP_CONCAT(website_id ORDER BY website_id) AS ids
       FROM organization_invitation_websites WHERE organization_id = ? AND invitation_id = ?`,
      [organizationId, id]
    );
    const row = rows[0];
    return {
      id,
      email: row.email,
      role: row.role,
      status: row.status === "pending" && new Date(row.expires_at) <= now() ? "expired" : row.status,
      deliveryStatus: row.delivery_status,
      deliveryError: row.delivery_error,
      expiresAt: row.expires_at,
      invitedBy: Number(row.invited_by_user_id),
      acceptedBy: row.accepted_by_user_id === null ? null : Number(row.accepted_by_user_id),
      acceptedAt: row.accepted_at,
      createdAt: row.created_at,
      websiteIds: websites.ids ? String(websites.ids).split(",").map(Number) : []
    };
  }

  async function sendExistingInvitation(invitationId, organizationId, actorUserId, token) {
    const invitation = await getInvitation(organizationId, invitationId);
    try {
      await deliverInvitation({
        email: invitation.email,
        organizationName: (await getOrganizationSettings(organizationId)).name,
        role: invitation.role,
        token
      });
      await db.execute(
        "UPDATE organization_invitations SET delivery_status = 'sent', delivery_error = NULL WHERE organization_id = ? AND invitation_id = ?",
        [organizationId, invitationId]
      );
      return { ...await getInvitation(organizationId, invitationId), deliveryStatus: "sent" };
    } catch (error) {
      logDeliveryFailure(getDeliveryDiagnostic(error));
      await db.execute(
        "UPDATE organization_invitations SET delivery_status = 'failed', delivery_error = 'SMTP delivery failed' WHERE organization_id = ? AND invitation_id = ?",
        [organizationId, invitationId]
      );
      await writeActivity(db, {
        organizationId,
        actorUserId,
        action: "invitation.delivery_failed",
        resourceType: "organization_invitation",
        resourceId: invitationId,
        metadata: { deliveryStatus: "failed" }
      });
      return { ...await getInvitation(organizationId, invitationId), deliveryStatus: "failed" };
    }
  }

  async function createInvitation(organizationId, actorUserId, { email, role, websiteIds }) {
    assertRole(role);
    if (role !== "admin") {
      throw new HttpError(422, "Google invitations are reserved for Admin accounts. Create Analysts and Viewers as employee accounts.", "VALIDATION_ERROR");
    }
    if (!isSmtpConfigured()) {
      throw new HttpError(503, "Invitation email is not configured. Configure SMTP before inviting employees.", "EMAIL_NOT_CONFIGURED");
    }
    const normalizedEmail = email.trim().toLowerCase();
    const uniqueIds = [...new Set(websiteIds.map((id) => assertId(id, "websiteId")))];
    if (uniqueIds.length !== websiteIds.length) {
      throw new HttpError(422, "websiteIds must not contain duplicates.", "VALIDATION_ERROR");
    }
    const [members] = await db.execute(
      `SELECT m.status FROM organization_members m
       JOIN users u ON u.user_id = m.user_id
       WHERE m.organization_id = ? AND LOWER(TRIM(u.email)) = ?`,
      [organizationId, normalizedEmail]
    );
    if (members.some((member) => member.status === "active")) {
      throw new HttpError(409, "This email already belongs to an active organization member.", "MEMBERSHIP_ALREADY_EXISTS");
    }
    const [existing] = await db.execute(
      `SELECT invitation_id FROM organization_invitations
       WHERE organization_id = ? AND email_normalized = ? AND status = 'pending' AND expires_at > NOW()
       LIMIT 1`,
      [organizationId, normalizedEmail]
    );
    if (existing.length) {
      throw new HttpError(409, "An unexpired invitation already exists for this email.", "INVITATION_ALREADY_EXISTS");
    }
    const [sites] = uniqueIds.length
      ? await db.query(
          `SELECT website_id FROM website_credentials
           WHERE organization_id = ? AND website_id IN (${uniqueIds.map(() => "?").join(",")})`,
          [organizationId, ...uniqueIds]
        )
      : [[]];
    if (sites.length !== uniqueIds.length) {
      throw new HttpError(404, "One or more websites do not belong to this organization.", "WEBSITE_NOT_FOUND");
    }
    const token = createInvitationToken();
    const tokenHash = invitationTokenHash(token);
    let invitationId;
    try {
      invitationId = await withTransaction(db, async (connection) => {
        const [[org]] = await connection.execute(
          "SELECT invitation_expiry_hours FROM organizations WHERE organization_id = ? FOR UPDATE",
          [organizationId]
        );
        const [result] = await connection.execute(
          `INSERT INTO organization_invitations
           (organization_id, email, email_normalized, role, invitation_token_hash,
            status, delivery_status, expires_at, invited_by_user_id)
           VALUES (?, ?, ?, ?, ?, 'pending', 'queued',
             DATE_ADD(NOW(), INTERVAL ? HOUR), ?)`,
          [organizationId, email.trim(), normalizedEmail, role, tokenHash, org.invitation_expiry_hours, actorUserId]
        );
        for (const websiteId of uniqueIds) {
          await connection.execute(
            `INSERT INTO organization_invitation_websites (organization_id, invitation_id, website_id)
             VALUES (?, ?, ?)`,
            [organizationId, result.insertId, websiteId]
          );
        }
        await writeActivity(connection, {
          organizationId,
          actorUserId,
          action: "employee.invited",
          resourceType: "organization_invitation",
          resourceId: result.insertId,
          metadata: { email: normalizedEmail, role, websiteIds: uniqueIds }
        });
        return Number(result.insertId);
      });
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        throw new HttpError(409, "An unexpired invitation already exists for this email.", "INVITATION_ALREADY_EXISTS");
      }
      throw error;
    }
    return sendExistingInvitation(invitationId, organizationId, actorUserId, token);
  }

  async function resendInvitation(organizationId, actorUserId, invitationId) {
    if (!isSmtpConfigured()) {
      throw new HttpError(503, "Invitation email is not configured. Configure SMTP before resending.", "EMAIL_NOT_CONFIGURED");
    }
    const id = assertId(invitationId, "invitationId");
    const token = createInvitationToken();
    const [organizationRows] = await db.execute(
      "SELECT invitation_expiry_hours FROM organizations WHERE organization_id = ?",
      [organizationId]
    );
    if (!organizationRows.length) throw new HttpError(404, "Organization not found.", "ORGANIZATION_NOT_FOUND");
    const [result] = await db.execute(
      `UPDATE organization_invitations
       SET invitation_token_hash = ?, status = 'pending', delivery_status = 'queued',
           delivery_error = NULL, expires_at = DATE_ADD(NOW(), INTERVAL ? HOUR)
       WHERE organization_id = ? AND invitation_id = ? AND status IN ('pending','expired')`,
      [invitationTokenHash(token), organizationRows[0].invitation_expiry_hours, organizationId, id]
    );
    if (!result.affectedRows) throw new HttpError(404, "Pending or expired invitation not found.", "INVITATION_NOT_FOUND");
    await writeActivity(db, {
      organizationId,
      actorUserId,
      action: "invitation.resent",
      resourceType: "organization_invitation",
      resourceId: id,
      metadata: { deliveryStatus: "queued" }
    });
    return sendExistingInvitation(id, organizationId, actorUserId, token);
  }

  async function revokeInvitation(organizationId, actorUserId, invitationId) {
    const id = assertId(invitationId, "invitationId");
    await withTransaction(db, async (connection) => {
      const [rows] = await connection.execute(
        `SELECT status FROM organization_invitations
         WHERE organization_id = ? AND invitation_id = ? FOR UPDATE`,
        [organizationId, id]
      );
      if (!rows.length) throw new HttpError(404, "Invitation not found.", "INVITATION_NOT_FOUND");
      if (rows[0].status === "accepted") throw new HttpError(409, "An accepted invitation cannot be revoked.", "INVITATION_ALREADY_ACCEPTED");
      await connection.execute(
        `UPDATE organization_invitations SET status = 'revoked'
         WHERE organization_id = ? AND invitation_id = ?`,
        [organizationId, id]
      );
      await writeActivity(connection, {
        organizationId,
        actorUserId,
        action: "invitation.revoked",
        resourceType: "organization_invitation",
        resourceId: id,
        metadata: { previousStatus: rows[0].status, newStatus: "revoked" }
      });
    });
    return getInvitation(organizationId, id);
  }

  async function acceptInvitation(user, token) {
    if (typeof token !== "string" || token.length < 20 || token.length > 200) {
      throw new HttpError(422, "A valid invitation token is required.", "INVALID_INVITATION_TOKEN");
    }
    const tokenHash = invitationTokenHash(token);
    return withTransaction(db, async (connection) => {
      const [rows] = await connection.execute(
        `SELECT i.*, o.status AS organization_status
         FROM organization_invitations i
         JOIN organizations o ON o.organization_id = i.organization_id
         WHERE i.invitation_token_hash = ? LIMIT 1 FOR UPDATE`,
        [tokenHash]
      );
      const invitation = rows[0];
      if (!invitation || invitation.status !== "pending" || new Date(invitation.expires_at) <= now()) {
        throw new HttpError(404, "Invitation is invalid, expired, or already used.", "INVITATION_NOT_FOUND");
      }
      if (invitation.role !== "admin") {
        throw new HttpError(403, "Google invitation acceptance is reserved for Admin accounts.", "GOOGLE_ADMIN_ONLY");
      }
      if (invitation.organization_status !== "active") {
        throw new HttpError(403, "This organization is inactive.", "ORGANIZATION_INACTIVE");
      }
      if (String(invitation.email_normalized).toLowerCase() !== String(user.email).trim().toLowerCase()) {
        throw new HttpError(403, "Sign in with the Google account that received this invitation.", "INVITATION_EMAIL_MISMATCH");
      }
      const [existingMembers] = await connection.execute(
        `SELECT status FROM organization_members
         WHERE organization_id = ? AND user_id = ? FOR UPDATE`,
        [invitation.organization_id, user.user_id]
      );
      if (existingMembers.some((member) => member.status === "active")) {
        throw new HttpError(409, "This account is already an active organization member.", "MEMBERSHIP_ALREADY_EXISTS");
      }
      const [otherMemberships] = await connection.execute(
        `SELECT organization_id FROM organization_members
         WHERE user_id = ? AND status = 'active' AND organization_id <> ? FOR UPDATE`,
        [user.user_id, invitation.organization_id]
      );
      if (otherMemberships.length) {
        throw new HttpError(409, "This account already belongs to another active organization.", "ORGANIZATION_MEMBERSHIP_EXISTS");
      }
      await connection.execute(
        `INSERT INTO organization_members (organization_id, user_id, role, status, joined_at)
         VALUES (?, ?, ?, 'active', NOW())
         ON DUPLICATE KEY UPDATE role = VALUES(role), status = 'active', joined_at = NOW()`,
        [invitation.organization_id, user.user_id, invitation.role]
      );
      const [assignments] = await connection.execute(
        `SELECT website_id FROM organization_invitation_websites
         WHERE organization_id = ? AND invitation_id = ?`,
        [invitation.organization_id, invitation.invitation_id]
      );
      const canManage = invitation.role === "admin" || invitation.role === "analyst";
      for (const { website_id: websiteId } of assignments) {
        await connection.execute(
          `INSERT INTO website_permissions
           (organization_id, user_id, website_id, can_view, can_manage, can_manage_keywords)
           VALUES (?, ?, ?, TRUE, ?, ?)
           ON DUPLICATE KEY UPDATE can_view = TRUE, can_manage = VALUES(can_manage),
             can_manage_keywords = VALUES(can_manage_keywords)`,
          [invitation.organization_id, user.user_id, websiteId, canManage, canManage]
        );
      }
      await connection.execute(
        `UPDATE organization_invitations
         SET status = 'accepted', accepted_by_user_id = ?, accepted_at = NOW()
         WHERE invitation_id = ?`,
        [user.user_id, invitation.invitation_id]
      );
      await writeActivity(connection, {
        organizationId: invitation.organization_id,
        actorUserId: user.user_id,
        targetUserId: user.user_id,
        action: "invitation.accepted",
        resourceType: "organization_invitation",
        resourceId: invitation.invitation_id,
        metadata: { role: invitation.role, websiteIds: assignments.map((row) => Number(row.website_id)) }
      });
      return {
        organizationId: Number(invitation.organization_id),
        role: invitation.role,
        status: "active",
        websiteIds: assignments.map((row) => Number(row.website_id))
      };
    });
  }

  async function getOrganizationSettings(organizationId, queryDb = db) {
    const [rows] = await queryDb.execute(
      `SELECT organization_id, organization_name, organization_key, default_timezone,
              status, report_exports_enabled, viewer_exports_enabled,
              invitation_expiry_hours, created_at, updated_at
       FROM organizations WHERE organization_id = ? LIMIT 1`,
      [organizationId]
    );
    if (!rows.length) throw new HttpError(404, "Organization not found.", "ORGANIZATION_NOT_FOUND");
    const row = rows[0];
    return {
      id: Number(row.organization_id),
      name: row.organization_name,
      slug: row.organization_key,
      defaultTimezone: row.default_timezone,
      status: row.status,
      reportExportsEnabled: Boolean(row.report_exports_enabled),
      viewerExportsEnabled: Boolean(row.viewer_exports_enabled),
      invitationExpiryHours: Number(row.invitation_expiry_hours),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async function updateOrganizationSettings(organizationId, actorUserId, changes) {
    const allowed = {
      name: ["organization_name", (value) => value],
      defaultTimezone: ["default_timezone", (value) => value],
      reportExportsEnabled: ["report_exports_enabled", (value) => value],
      viewerExportsEnabled: ["viewer_exports_enabled", (value) => value],
      invitationExpiryHours: ["invitation_expiry_hours", (value) => value]
    };
    const fields = Object.keys(changes).filter((key) => Object.hasOwn(allowed, key));
    if (!fields.length) throw new HttpError(422, "At least one supported setting is required.", "VALIDATION_ERROR");
    await withTransaction(db, async (connection) => {
      const previous = await getOrganizationSettings(organizationId, connection);
      const updates = [];
      const values = [];
      const before = {};
      const after = {};
      for (const field of fields) {
        const [column, normalize] = allowed[field];
        const oldValue = previous[field];
        const newValue = normalize(changes[field]);
        if (oldValue !== newValue) {
          updates.push(`${column} = ?`);
          values.push(newValue);
          before[field] = oldValue;
          after[field] = newValue;
        }
      }
      if (updates.length) {
        await connection.execute(
          `UPDATE organizations SET ${updates.join(", ")} WHERE organization_id = ?`,
          [...values, organizationId]
        );
        await writeActivity(connection, {
          organizationId,
          actorUserId,
          action: "organization.settings_changed",
          resourceType: "organization",
          resourceId: organizationId,
          metadata: { previous: before, changes: after }
        });
      }
    });
    return getOrganizationSettings(organizationId);
  }

  async function listIntegrations(organizationId) {
    const [rows] = await db.execute(
      `SELECT w.website_id, w.website_name, w.domain_name, w.ga4_property_id,
              w.gsc_property_url, w.owner_user_id, owner.email AS connection_owner_email,
              t.google_email, t.is_active AS google_connected, t.last_error AS connection_error,
              t.last_refreshed_at,
              MAX(CASE WHEN sc.status = 'completed' THEN sc.last_sync_completed_at END) AS last_successful_sync
       FROM website_credentials w
       JOIN users owner ON owner.user_id = w.owner_user_id
       LEFT JOIN google_oauth_tokens t ON t.user_id = w.owner_user_id
       LEFT JOIN sync_checkpoints sc ON sc.website_id = w.website_id
       WHERE w.organization_id = ?
       GROUP BY w.website_id, w.website_name, w.domain_name, w.ga4_property_id,
                w.gsc_property_url, w.owner_user_id, owner.email,
                t.google_email, t.is_active, t.last_error, t.last_refreshed_at
       ORDER BY w.website_name`,
      [organizationId]
    );
    return rows.map((row) => ({
      websiteId: Number(row.website_id),
      websiteName: row.website_name,
      domainName: row.domain_name,
      ga4PropertyId: row.ga4_property_id,
      gscPropertyUrl: row.gsc_property_url,
      connectionOwner: { userId: Number(row.owner_user_id), email: row.connection_owner_email },
      connected: Boolean(row.google_connected),
      connectedGoogleAccount: row.google_email,
      connectionError: row.connection_error,
      lastTokenRefresh: row.last_refreshed_at,
      lastSuccessfulSync: row.last_successful_sync
    }));
  }

  async function listActivity(organizationId, {
    actorUserId = "",
    action = "",
    resourceType = "",
    startDate = "",
    endDate = "",
    page = 1,
    limit = 20,
    order = "desc"
  }) {
    const conditions = ["a.organization_id = ?"];
    const params = [organizationId];
    if (actorUserId) {
      conditions.push("a.actor_user_id = ?");
      params.push(assertId(actorUserId, "actorUserId"));
    }
    if (action) {
      conditions.push("a.action = ?");
      params.push(action);
    }
    if (resourceType) {
      conditions.push("a.resource_type = ?");
      params.push(resourceType);
    }
    if (startDate) {
      conditions.push("a.created_at >= ?");
      params.push(`${startDate} 00:00:00`);
    }
    if (endDate) {
      conditions.push("a.created_at < DATE_ADD(?, INTERVAL 1 DAY)");
      params.push(endDate);
    }
    const where = conditions.join(" AND ");
    const [[count]] = await db.execute(
      `SELECT COUNT(*) AS total FROM activity_logs a WHERE ${where}`,
      params
    );
    const [rows] = await db.execute(
      `SELECT a.activity_id, a.actor_user_id, u.display_name AS actor_name,
              a.action, a.resource_type, a.resource_id, a.metadata, a.created_at
       FROM activity_logs a LEFT JOIN users u ON u.user_id = a.actor_user_id
       WHERE ${where} ORDER BY a.activity_id ${order === "asc" ? "ASC" : "DESC"}
       LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    );
    return {
      data: rows,
      pagination: { page, limit, total: Number(count.total) }
    };
  }

  return {
    getOverview,
    listMembers,
    getMember,
    createEmployee,
    resetEmployeePassword,
    changeMemberRole,
    changeMemberStatus,
    revokeMember,
    getWebsiteAccess,
    replaceWebsiteAccess,
    listWebsites,
    createInvitation,
    listInvitations,
    getInvitation,
    resendInvitation,
    revokeInvitation,
    acceptInvitation,
    getOrganizationSettings,
    updateOrganizationSettings,
    listIntegrations,
    listActivity
  };
}

export const adminService = createAdminService();
