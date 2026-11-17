import express from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import {
  requireAuth,
  requireOrganizationMembership,
  requirePasswordChange,
  requireRole,
} from "../middleware/auth.js";
import { requireWebsiteReportAccess } from "../middleware/reports-access.js";
import { enqueueHistoricalBackfill, requestManualSync } from "../services/sync.service.js";
import { HttpError } from "../utils/http-error.js";

export const websitesRouter = express.Router();
websitesRouter.use(requireAuth, requireOrganizationMembership, requirePasswordChange);

const websiteSchema = z.object({
  websiteName: z.string().trim().min(1).max(255),
  domainName: z.string().trim().url().max(2048),
  ga4PropertyId: z.string().trim().regex(/^\d{4,20}$/, "GA4 Property ID should be numeric."),
  gscPropertyUrl: z.string().trim().max(2048).optional().or(z.literal("")),
  timezone: z.string().trim().max(64).optional(),
  currencyCode: z.string().trim().length(3).optional()
});

websitesRouter.get("/", async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT w.website_id, w.website_name, w.domain_name, w.ga4_property_id,
              w.gsc_property_url, w.timezone, w.currency_code, w.created_at,
              (SELECT COUNT(*) FROM sync_jobs j WHERE j.website_id = w.website_id AND j.status IN ('queued','running')) AS active_sync_jobs,
              (w.owner_user_id = ?) AS can_manage
       FROM website_credentials w
       LEFT JOIN website_permissions p
         ON p.organization_id = w.organization_id
         AND p.website_id = w.website_id
         AND p.user_id = ?
         AND p.can_view = TRUE
       WHERE w.organization_id = ? AND w.is_active = TRUE
         AND (? = 'admin' OR p.user_id IS NOT NULL)
       ORDER BY w.website_name`,
      [req.user.user_id, req.user.user_id, req.organization.organization_id, req.membership.role]
    );
    for (const website of rows) {
      website.permissions = {
        canManage: req.membership.role === "admin",
        canManageKeywords: req.membership.role === "admin",
        canSync: req.membership.role === "admin"
      };
      delete website.can_manage;
    }
    const freshness = [];
    for (const website of rows) {
      const [checkpoints] = await pool.execute(
        `SELECT source, report_type, last_successful_date, last_sync_completed_at, status
         FROM sync_checkpoints WHERE website_id = ?`,
        [website.website_id]
      );
      freshness.push({ websiteId: website.website_id, checkpoints });
    }
    res.json({ websites: rows, freshness });
  } catch (error) {
    next(error);
  }
});

websitesRouter.post("/", requireRole("admin"), async (req, res, next) => {
  try {
    const parsed = websiteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join(" "), "VALIDATION_ERROR");
    }
    const body = parsed.data;
    const connection = await pool.getConnection();
    let website;
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute(
        `INSERT INTO website_credentials
         (owner_user_id, organization_id, website_name, domain_name, ga4_property_id,
          gsc_property_url, timezone, currency_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.user_id, req.organization.organization_id,
          body.websiteName, body.domainName, body.ga4PropertyId,
          body.gscPropertyUrl || null, body.timezone || req.organization.default_timezone || "UTC",
          body.currencyCode || null
        ]
      );
      await connection.execute(
        `INSERT INTO website_permissions
         (organization_id, user_id, website_id, can_view, can_manage, can_manage_keywords, assigned_by_user_id)
         VALUES (?, ?, ?, TRUE, ?, ?, ?)`,
        [
          req.organization.organization_id, req.user.user_id, result.insertId,
          true, true, req.user.user_id
        ]
      );
      const [rows] = await connection.execute(
        "SELECT * FROM website_credentials WHERE website_id = ? AND owner_user_id = ?",
        [result.insertId, req.user.user_id]
      );
      website = rows[0];
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    const jobs = await enqueueHistoricalBackfill(website);
    res.status(202).json({
      website,
      import: { status: "queued", jobs },
      message: "Website saved. Available history is being imported in the background."
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return next(new HttpError(409, "This GA4 property is already added to your account.", "WEBSITE_ALREADY_EXISTS"));
    }
    next(error);
  }
});

websitesRouter.get("/:websiteId", requireWebsiteReportAccess, async (req, res) => {
  const [checkpoints] = await pool.execute(
    `SELECT source, report_type, last_successful_date, last_sync_completed_at, status
     FROM sync_checkpoints WHERE website_id = ?`,
    [req.website.website_id]
  );
  res.json({ website: req.website, checkpoints });
});

websitesRouter.post("/:websiteId/sync", requireRole("admin"), requireWebsiteReportAccess, async (req, res, next) => {
  try {
    const jobs = await requestManualSync(req.user.user_id, req.website);
    res.status(202).json({ jobs, message: "Refresh jobs queued." });
  } catch (error) {
    next(error);
  }
});
