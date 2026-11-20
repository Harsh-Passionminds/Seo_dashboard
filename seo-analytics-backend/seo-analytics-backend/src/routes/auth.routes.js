import crypto from "node:crypto";
import express from "express";
import { google } from "googleapis";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { clearSessionCookie, optionalAuth, requireAuth, setSessionCookie } from "../middleware/auth.js";
import { createOAuthClient, getGoogleConsentUrl, persistOAuthTokens } from "../services/google-oauth.service.js";
import { ensureFreshnessForUser } from "../services/sync.service.js";
import { adminService } from "../services/admin.service.js";
import { createEmployeeAuthService } from "../services/employee-auth.service.js";
import { canGoogleAuthenticateAsAdmin } from "../services/auth-policy.service.js";
import { ensureBootstrapAdminMembership } from "../services/organization-bootstrap.service.js";
import { requireOrganizationMembership, requireRole } from "../middleware/auth.js";
import { HttpError } from "../utils/http-error.js";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";

export const authRouter = express.Router();

const invitationAcceptanceSchema = z.object({
  token: z.string().min(20).max(200)
}).strict();
const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200)
}).strict();
const changePasswordSchema = z.object({
  password: z.string().min(12).max(72)
}).strict();
const employeeAuthService = createEmployeeAuthService({ db: pool });
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(401, "Invalid username or password.", "INVALID_CREDENTIALS");
    }
    const user = await employeeAuthService.login(parsed.data.username, parsed.data.password);
    setSessionCookie(res, user);
    res.json({
      authenticated: true,
      mustChangePassword: Boolean(user.must_change_password)
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/google", (_req, res) => {
  const state = crypto.randomBytes(32).toString("hex");
  res.cookie("oauth_state", state, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/api/auth/google/callback",
    maxAge: 10 * 60 * 1000
  });
  res.redirect(getGoogleConsentUrl(state));
});

authRouter.get("/google/callback", async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    const cookieState = req.cookies?.oauth_state;
    res.clearCookie("oauth_state", { path: "/api/auth/google/callback", sameSite: "lax", secure: env.isProduction });
    if (error) throw new HttpError(401, "Google sign-in was cancelled or denied. Please try again.", "OAUTH_DENIED");
    if (!code || !state || !cookieState || state !== cookieState) {
      throw new HttpError(400, "OAuth state validation failed. Restart Google sign-in.", "OAUTH_STATE_INVALID");
    }

    const oauth = createOAuthClient();
    const { tokens } = await oauth.getToken(String(code));
    oauth.setCredentials(tokens);
    if (!tokens.id_token) throw new HttpError(401, "Google did not return an identity token.", "OAUTH_ID_TOKEN_MISSING");

    const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email) throw new HttpError(401, "Google account identity is incomplete.", "OAUTH_PROFILE_INVALID");

    const [existingUsers] = await pool.execute(
      "SELECT user_id FROM users WHERE google_sub = ? LIMIT 1",
      [profile.sub]
    );
    const existingUserId = existingUsers[0]?.user_id;
    const [memberships] = existingUserId
      ? await pool.execute(
          "SELECT role, status FROM organization_members WHERE user_id = ?",
          [existingUserId]
        )
      : [[]];
    let pendingAdminInvitation = false;
    const activeAdmin = memberships.some((membership) => membership.status === "active" && membership.role === "admin");
    if (!activeAdmin) {
      const [invitations] = await pool.execute(
        `SELECT i.invitation_id
         FROM organization_invitations i
         JOIN organizations o ON o.organization_id = i.organization_id
         WHERE i.email_normalized = LOWER(TRIM(?)) AND i.status = 'pending'
           AND i.role = 'admin' AND i.expires_at > NOW() AND o.status = 'active'
         LIMIT 1`,
        [profile.email]
      );
      pendingAdminInvitation = invitations.length > 0;
    }
    const bootstrapAdmin = Boolean(env.INITIAL_ORG_ADMIN_EMAIL) &&
      env.INITIAL_ORG_ADMIN_EMAIL.toLowerCase() === profile.email.toLowerCase();
    if (!canGoogleAuthenticateAsAdmin({ memberships, pendingAdminInvitation, bootstrapAdmin })) {
      const activeEmployee = memberships.some((membership) =>
        membership.status === "active" && membership.role !== "admin"
      );
      throw new HttpError(
        403,
        activeEmployee ? "Google sign-in is reserved for organization Admins." : "This account does not have active organization access.",
        activeEmployee ? "GOOGLE_ADMIN_ONLY" : "ACCOUNT_ACCESS_REVOKED"
      );
    }
    const [userResult] = await pool.execute(
      `INSERT INTO users (google_sub, email, display_name)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE email = VALUES(email), display_name = VALUES(display_name), user_id = LAST_INSERT_ID(user_id)`,
      [profile.sub, profile.email, profile.name || null]
    );
    const userId = userResult.insertId;
    if (bootstrapAdmin) {
      await ensureBootstrapAdminMembership(pool, userId);
    }
    await persistOAuthTokens(userId, profile, tokens);

    const [users] = await pool.execute(
      "SELECT user_id, email, session_version FROM users WHERE user_id = ? LIMIT 1",
      [userId]
    );
    setSessionCookie(res, users[0]);
    void ensureFreshnessForUser(userId).catch((err) => console.error("Post-login freshness check failed:", err.message));
    res.redirect(`${env.FRONTEND_URL.replace(/\/$/, "")}/`);
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", optionalAuth, async (req, res, next) => {
  try {
    if (!req.user) return res.json({ authenticated: false, user: null });
    const [memberships] = await pool.execute(
      `SELECT o.organization_id, o.organization_name, o.default_timezone,
              o.report_exports_enabled, o.viewer_exports_enabled,
              m.role, m.status
       FROM organization_members m
       JOIN organizations o ON o.organization_id = m.organization_id
       WHERE m.user_id = ? AND m.status = 'active' AND o.status = 'active'
       ORDER BY m.organization_id LIMIT 2`,
      [req.user.user_id]
    );
    const membership = memberships.length === 1 ? memberships[0] : null;
    const isAdmin = membership?.role === "admin" && Boolean(req.user.google_sub);
    const [tokens] = isAdmin
      ? await pool.execute(
          "SELECT is_active, google_email, last_error FROM google_oauth_tokens WHERE user_id = ? ORDER BY last_refreshed_at DESC LIMIT 1",
          [req.user.user_id]
        )
      : [[]];
    if (isAdmin && !req.user.must_change_password) {
      void ensureFreshnessForUser(req.user.user_id).catch((err) => console.error("Freshness check failed:", err.message));
    }
    res.json({
      authenticated: true,
      user: {
        id: req.user.user_id,
        email: req.user.email,
        name: req.user.display_name,
        username: req.user.username || null
      },
      mustChangePassword: Boolean(req.user.must_change_password),
      organization: membership ? {
        id: membership.organization_id,
        name: membership.organization_name,
        defaultTimezone: membership.default_timezone
      } : null,
      membership: membership ? {
        role: membership.role,
        status: membership.status
      } : null,
      permissions: membership ? {
        canManageOrganization: isAdmin,
        canCreateWebsites: isAdmin,
        canExportReports: membership.role === "admin" ||
          (membership.role === "analyst" && Boolean(membership.report_exports_enabled)) ||
          (membership.role === "viewer" && Boolean(membership.viewer_exports_enabled))
      } : null,
      organizationContextRequired: memberships.length > 1,
      googleConnection: isAdmin && tokens[0] ? {
        connected: Boolean(tokens[0].is_active),
        email: tokens[0].google_email,
        error: tokens[0].last_error
      } : { connected: false }
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/change-password", optionalAuth, requireAuth, requireOrganizationMembership, async (req, res, next) => {
  try {
    if (!req.user.must_change_password) {
      throw new HttpError(409, "No temporary password change is pending.", "PASSWORD_CHANGE_NOT_REQUIRED");
    }
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(422, "Password must be at least 12 characters and no more than 72 characters.", "VALIDATION_ERROR");
    }
    const user = await employeeAuthService.changeTemporaryPassword(req.user.user_id, parsed.data.password);
    setSessionCookie(res, user);
    res.json({ success: true, mustChangePassword: false });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", optionalAuth, async (req, res, next) => {
  try {
    if (req.user) {
      await pool.execute(
        "UPDATE users SET session_version = session_version + 1 WHERE user_id = ?",
        [req.user.user_id]
      );
    }
    clearSessionCookie(res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

authRouter.post(
  "/disconnect-google",
  optionalAuth,
  requireAuth,
  requireOrganizationMembership,
  requireRole("admin"),
  async (req, res, next) => {
  try {
    await pool.execute(
      "UPDATE google_oauth_tokens SET is_active = FALSE WHERE user_id = ?",
      [req.user.user_id]
    );
    clearSessionCookie(res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

authRouter.post("/invitations/accept", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    const parsed = invitationAcceptanceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(422, "A valid invitation token is required.", "VALIDATION_ERROR");
    }
    const membership = await adminService.acceptInvitation(req.user, parsed.data.token);
    res.json({
      success: true,
      message: "Invitation accepted successfully",
      data: membership
    });
  } catch (error) {
    next(error);
  }
});
