import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: new URL("../../.env", import.meta.url) });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default("http://localhost:5500"),
  API_BASE_PATH: z.string().default("/api"),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  SESSION_JWT_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY_HEX: z.string().regex(/^[a-fA-F0-9]{64}$/),
  ORGANIZATION_NAME: z.string().trim().min(1).max(255).default("SEO Analytics Organization"),
  INITIAL_ORG_ADMIN_EMAIL: z.string().trim().email().optional().or(z.literal("")),
  SMTP_HOST: z.string().trim().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.string().default("false"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  INVITATION_FROM_EMAIL: z.string().trim().email().optional(),
  SYNC_WORKER_ENABLED: z.string().default("true"),
  SYNC_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  SYNC_FRESHNESS_HOURS: z.coerce.number().positive().default(24),
  GA4_LOOKBACK_DAYS: z.coerce.number().int().positive().default(7),
  GSC_LOOKBACK_DAYS: z.coerce.number().int().positive().default(3),
  HISTORICAL_MONTHS: z.coerce.number().int().positive().default(16),
  SYNC_CHUNK_DAYS: z.coerce.number().int().positive().default(30),
  MAX_SYNC_ATTEMPTS: z.coerce.number().int().positive().default(3)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Set the required environment variables in the project .env file.");
}
export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === "production",
  smtpConfigured: Boolean(
    parsed.data.SMTP_HOST && parsed.data.INVITATION_FROM_EMAIL &&
    parsed.data.SMTP_USER && parsed.data.SMTP_PASSWORD
  ),
  smtpSecure: parsed.data.SMTP_SECURE.toLowerCase() === "true",
  syncWorkerEnabled: parsed.data.SYNC_WORKER_ENABLED.toLowerCase() === "true"
};
