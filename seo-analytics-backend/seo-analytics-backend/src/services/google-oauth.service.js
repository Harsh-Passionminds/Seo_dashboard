import { google } from "googleapis";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { encryptSecret, decryptSecret } from "../utils/crypto.js";
import { HttpError } from "../utils/http-error.js";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly"
];

export function createOAuthClient() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
}

export function getGoogleConsentUrl(state) {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state
  });
}

export async function persistOAuthTokens(userId, profile, credentials) {
  const accessToken = credentials.access_token || null;
  const refreshToken = credentials.refresh_token || null;
  const expiresAt = credentials.expiry_date ? new Date(credentials.expiry_date) : null;
  const scopeList = credentials.scope ? credentials.scope.split(" ") : GOOGLE_SCOPES;

  const [existingRows] = await pool.execute(
    "SELECT token_id, refresh_token_encrypted FROM google_oauth_tokens WHERE user_id = ? AND google_account_id = ? LIMIT 1",
    [userId, profile.sub]
  );
  const oldRefresh = existingRows[0]?.refresh_token_encrypted || null;
  const encryptedRefresh = refreshToken ? encryptSecret(refreshToken) : oldRefresh;

  if (existingRows.length) {
    await pool.execute(
      `UPDATE google_oauth_tokens
       SET google_email = ?, access_token_encrypted = ?, refresh_token_encrypted = ?,
           token_type = ?, expires_at = ?, scopes_json = ?, is_active = TRUE,
           last_refreshed_at = NOW(), last_error = NULL
       WHERE token_id = ?`,
      [
        profile.email || null,
        accessToken ? encryptSecret(accessToken) : null,
        encryptedRefresh,
        credentials.token_type || "Bearer",
        expiresAt,
        JSON.stringify(scopeList),
        existingRows[0].token_id
      ]
    );
  } else {
    if (!encryptedRefresh) {
      throw new HttpError(400, "Google did not provide a refresh token. Revoke this app's access in your Google Account and sign in again with consent.", "MISSING_REFRESH_TOKEN");
    }
    await pool.execute(
      `INSERT INTO google_oauth_tokens
       (user_id, google_account_id, google_email, access_token_encrypted,
        refresh_token_encrypted, token_type, expires_at, scopes_json,
        is_active, last_refreshed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, NOW())`,
      [
        userId, profile.sub, profile.email || null,
        accessToken ? encryptSecret(accessToken) : null,
        encryptedRefresh, credentials.token_type || "Bearer",
        expiresAt, JSON.stringify(scopeList)
      ]
    );
  }
}

export async function getAuthorizedGoogleClient(userId) {
  const [rows] = await pool.execute(
    `SELECT token_id, google_account_id, access_token_encrypted,
            refresh_token_encrypted, token_type, expires_at, scopes_json
     FROM google_oauth_tokens
     WHERE user_id = ? AND is_active = TRUE
     ORDER BY last_refreshed_at DESC LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  if (!row || !row.refresh_token_encrypted) {
    throw new HttpError(401, "Google access is disconnected. Sign in with Google again.", "GOOGLE_REAUTH_REQUIRED");
  }

  const scopes = Array.isArray(row.scopes_json)
    ? row.scopes_json
    : (typeof row.scopes_json === "string" ? JSON.parse(row.scopes_json || "[]") : []);
  const required = GOOGLE_SCOPES.filter((scope) => scope.startsWith("https://"));
  if (required.some((scope) => !scopes.includes(scope))) {
    throw new HttpError(403, "Required Google Analytics/Search Console permissions are missing. Reconnect Google and grant read access.", "GOOGLE_SCOPES_MISSING");
  }

  const client = createOAuthClient();
  client.setCredentials({
    access_token: decryptSecret(row.access_token_encrypted),
    refresh_token: decryptSecret(row.refresh_token_encrypted),
    token_type: row.token_type || "Bearer",
    expiry_date: row.expires_at ? new Date(row.expires_at).getTime() : undefined
  });

  client.on("tokens", (tokens) => {
    void (async () => {
      const encryptedAccess = tokens.access_token ? encryptSecret(tokens.access_token) : null;
      const encryptedRefresh = tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null;
      await pool.execute(
        `UPDATE google_oauth_tokens
         SET access_token_encrypted = COALESCE(?, access_token_encrypted),
             refresh_token_encrypted = COALESCE(?, refresh_token_encrypted),
             expires_at = ?, last_refreshed_at = NOW(), last_error = NULL
         WHERE token_id = ?`,
        [
          encryptedAccess,
          encryptedRefresh,
          tokens.expiry_date ? new Date(tokens.expiry_date) : row.expires_at,
          row.token_id
        ]
      );
    })().catch(() => {});
  });

  return client;
}
