import express from "express";
import { rateLimit } from "express-rate-limit";
import {
  requireAuth,
  requireOrganizationMembership,
  requirePasswordChange,
  requireRole
} from "../middleware/auth.js";
import {
  requireWebsiteReportAccess,
  requireWebsiteReportOwner
} from "../middleware/reports-access.js";
import { reportsController } from "../controllers/reports.controller.js";
import { reportExportsController } from "../controllers/report-exports.controller.js";
import { requireReportExportPermission } from "../middleware/report-export-access.js";

export const reportsRouter = express.Router();
reportsRouter.use(requireAuth, requireOrganizationMembership, requirePasswordChange);

const comparisonLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user.user_id)
});
const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user.user_id)
});

reportsRouter.get(
  "/:websiteId/reports/comparison",
  comparisonLimiter,
  requireWebsiteReportAccess,
  reportExportsController.compare
);
reportsRouter.get(
  "/:websiteId/reports/export",
  exportLimiter,
  requireWebsiteReportAccess,
  requireReportExportPermission,
  reportExportsController.exportReport
);

reportsRouter.get("/:websiteId/overview", requireWebsiteReportAccess, reportsController.getOverview);
reportsRouter.get("/:websiteId/gsc", requireWebsiteReportAccess, reportsController.getGsc);

reportsRouter.get("/:websiteId/gsc/keywords", requireWebsiteReportAccess, reportsController.listKeywords);
reportsRouter.post("/:websiteId/gsc/keywords", requireWebsiteReportOwner, reportsController.addKeyword);
reportsRouter.delete("/:websiteId/gsc/keywords/:keywordId", requireWebsiteReportOwner, reportsController.deleteKeyword);
reportsRouter.get(
  "/:websiteId/gsc/keywords/:keywordId/history",
  requireWebsiteReportAccess,
  reportsController.getKeywordHistory
);
reportsRouter.post(
  "/:websiteId/gsc/keywords/:keywordId/history/sync",
  requireWebsiteReportOwner,
  reportsController.syncKeywordHistory
);

reportsRouter.get("/:websiteId/ga4", requireWebsiteReportAccess, reportsController.getGa4);
reportsRouter.post(
  "/:websiteId/traffic-acquisition/sync",
  requireRole("admin"),
  requireWebsiteReportAccess,
  reportsController.syncTrafficAcquisition
);
