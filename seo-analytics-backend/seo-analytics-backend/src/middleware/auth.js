import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";

export const SESSION_COOKIE = "seo_session";

export function setSessionCookie(res, user) {
  const token = jwt.sign(
    {
      sub: String(user.user_id),
      email: user.email,
      sessionVersion: Number(user.session_version || 0)
    },
    env.SESSION_JWT_SECRET,
    { expiresIn: "7d", issuer: "seo-analytics", audience: "seo-analytics-web" }
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/"
  });
}

export async function optionalAuth(req, _res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, env.SESSION_JWT_SECRET, {
      issuer: "seo-analytics",
      audience: "seo-analytics-web"
    });
    const [rows] = await pool.execute(
      `SELECT u.user_id, u.google_sub, u.email, u.display_name, u.session_version,
              ec.username, COALESCE(ec.must_change_password, FALSE) AS must_change_password
       FROM users u
       LEFT JOIN employee_credentials ec ON ec.user_id = u.user_id
       WHERE u.user_id = ? LIMIT 1`,
      [Number(payload.sub)]
    );
    if (
      rows.length &&
      Number(payload.sessionVersion || 0) === Number(rows[0].session_version || 0)
    ) {
      req.user = rows[0];
    }
  } catch {
    // An invalid/expired cookie is treated as unauthenticated; never log the token.
  }
  next();
}

export async function requireOrganizationMembership(req, _res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT o.organization_id, o.organization_name, o.default_timezone,
              o.status AS organization_status,
              m.role, m.status AS membership_status
       FROM organization_members m
       JOIN organizations o ON o.organization_id = m.organization_id
       WHERE m.user_id = ? AND m.status = 'active' AND o.status = 'active'
       ORDER BY m.organization_id
       LIMIT 2`,
      [req.user.user_id]
    );
    if (!rows.length) {
      return next(new HttpError(403, "Active organization membership is required.", "ORGANIZATION_MEMBERSHIP_REQUIRED"));
    }
    if (rows.length > 1) {
      return next(new HttpError(409, "Select an organization before continuing.", "ORGANIZATION_CONTEXT_REQUIRED"));
    }
    req.organization = {
      organization_id: rows[0].organization_id,
      organization_name: rows[0].organization_name,
      default_timezone: rows[0].default_timezone
    };
    req.membership = {
      role: rows[0].role,
      status: rows[0].membership_status
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.membership || !roles.includes(req.membership.role)) {
      return next(new HttpError(403, "You do not have permission to perform this action.", "FORBIDDEN"));
    }
    next();
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, "Sign in to continue.", "AUTH_REQUIRED"));
  next();
}

export function requirePasswordChange(req, _res, next) {
  if (req.user?.must_change_password) {
    return next(new HttpError(403, "Change your temporary password to continue.", "PASSWORD_CHANGE_REQUIRED"));
  }
  next();
}

export async function requireWebsiteOwnership(req, _res, next) {
  const websiteId = Number(req.params.websiteId ?? req.params.id);
  if (!Number.isSafeInteger(websiteId) || websiteId <= 0) {
    return next(new HttpError(400, "Invalid website ID.", "INVALID_WEBSITE_ID"));
  }
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM website_credentials WHERE website_id = ? AND owner_user_id = ? AND is_active = TRUE LIMIT 1",
      [websiteId, req.user.user_id]
    );
    if (!rows.length) return next(new HttpError(404, "Website not found.", "WEBSITE_NOT_FOUND"));
    req.website = rows[0];
    next();
  } catch (error) {
    next(error);
  }
}
