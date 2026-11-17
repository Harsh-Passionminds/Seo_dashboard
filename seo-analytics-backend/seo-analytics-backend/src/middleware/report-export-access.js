import { reportsRepository } from "../repositories/reports.repository.js";
import { HttpError } from "../utils/http-error.js";

export function createRequireReportExportPermission(repository = reportsRepository) {
  return async function requireReportExportPermission(req, _res, next) {
    try {
      const policy = await repository.getReportExportPolicy({
        organizationId: req.organization.organization_id,
        userId: req.user.user_id,
        websiteId: req.website.website_id
      });
      if (!policy) {
        return next(new HttpError(404, "Website not found.", "WEBSITE_NOT_FOUND"));
      }

      const canExport = policy.role === "admin" ||
        (policy.role === "analyst" && Boolean(policy.report_exports_enabled)) ||
        (policy.role === "viewer" && Boolean(policy.viewer_exports_enabled));
      if (!canExport) {
        return next(new HttpError(403, "Your organization does not allow report exports for this role.", "REPORT_EXPORT_FORBIDDEN"));
      }
      req.reportExportPolicy = policy;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireReportExportPermission = createRequireReportExportPermission();
