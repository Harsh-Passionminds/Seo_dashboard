import crypto from "node:crypto";
import express from "express";
import { google } from "googleapis";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { clearSessionCookie, optionalAuth, requireAuth, setSessionCookie } from "../middleware/auth.js";
import { createOAuthClient, getGoogleConsentUrl, persistOAuthTokens } from "../services/google-oauth.service.js";
import { ensureFreshnessForUser } from "../services/sync.service.js";
import { HttpError } from "../utils/http-error.js";

export const authRouter = express.Router();

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

    const [userResult] = await pool.execute(
      `INSERT INTO users (google_sub, email, display_name)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE email = VALUES(email), display_name = VALUES(display_name), user_id = LAST_INSERT_ID(user_id)`,
      [profile.sub, profile.email, profile.name || null]
    );
    const userId = userResult.insertId;
    await persistOAuthTokens(userId, profile, tokens);

    const [users] = await pool.execute(
      "SELECT user_id, email FROM users WHERE user_id = ? LIMIT 1",
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
    const [tokens] = await pool.execute(
      "SELECT is_active, google_email, last_error FROM google_oauth_tokens WHERE user_id = ? ORDER BY last_refreshed_at DESC LIMIT 1",
      [req.user.user_id]
    );
    void ensureFreshnessForUser(req.user.user_id).catch((err) => console.error("Freshness check failed:", err.message));
    res.json({
      authenticated: true,
      user: { id: req.user.user_id, email: req.user.email, name: req.user.display_name },
      googleConnection: tokens[0] ? {
        connected: Boolean(tokens[0].is_active),
        email: tokens[0].google_email,
        error: tokens[0].last_error
      } : { connected: false }
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", optionalAuth, (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.post("/disconnect-google", optionalAuth, requireAuth, async (req, res, next) => {
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
