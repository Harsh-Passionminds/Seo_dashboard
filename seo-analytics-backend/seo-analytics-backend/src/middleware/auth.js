import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";

export const SESSION_COOKIE = "seo_session";

export function setSessionCookie(res, user) {
  const token = jwt.sign(
    { sub: String(user.user_id), email: user.email },
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
      "SELECT user_id, google_sub, email, display_name FROM users WHERE user_id = ? LIMIT 1",
      [Number(payload.sub)]
    );
    if (rows.length) req.user = rows[0];
  } catch {
    // An invalid/expired cookie is treated as unauthenticated; never log the token.
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, "Sign in with Google to continue.", "AUTH_REQUIRED"));
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
