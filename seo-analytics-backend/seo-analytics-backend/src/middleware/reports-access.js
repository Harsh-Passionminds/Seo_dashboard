import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";

function createWebsiteAccessMiddleware(db, allowViewGrant) {
  return async function requireWebsiteReportAccess(req, _res, next) {
    const websiteId = Number(req.params.websiteId);
    if (!Number.isSafeInteger(websiteId) || websiteId <= 0) {
      return next(new HttpError(400, "Invalid website ID.", "INVALID_WEBSITE_ID"));
    }
    if (!req.organization?.organization_id || !req.user?.user_id) {
      return next(new HttpError(403, "Active organization membership is required.", "ORGANIZATION_MEMBERSHIP_REQUIRED"));
    }

    try {
      const isAdmin = req.membership?.role === "admin";
      const permissionJoin = allowViewGrant
        ? `LEFT JOIN website_permissions p
             ON p.organization_id = w.organization_id
             AND p.website_id = w.website_id
             AND p.user_id = ?
             AND p.can_view = TRUE`
        : "";
      const accessCondition = allowViewGrant
        ? (isAdmin ? "TRUE" : "p.user_id IS NOT NULL")
        : (isAdmin ? "TRUE" : "FALSE");
      const params = allowViewGrant
        ? [req.user.user_id, websiteId, req.organization.organization_id]
        : [websiteId, req.organization.organization_id];
      const [rows] = await db.execute(
        `SELECT w.*
         FROM website_credentials w
         ${permissionJoin}
         WHERE w.website_id = ?
           AND w.organization_id = ?
           AND w.is_active = TRUE
           AND ${accessCondition}
         LIMIT 1`,
        params
      );
      if (!rows.length) {
        return next(new HttpError(404, "Website not found.", "WEBSITE_NOT_FOUND"));
      }
      req.website = rows[0];
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createRequireWebsiteReportAccess(db = pool) {
  return createWebsiteAccessMiddleware(db, true);
}

export function createRequireWebsiteReportOwner(db = pool) {
  return createWebsiteAccessMiddleware(db, false);
}

export const requireWebsiteReportAccess = createRequireWebsiteReportAccess();
export const requireWebsiteReportOwner = createRequireWebsiteReportOwner();
