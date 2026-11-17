import express from "express";
import { rateLimit } from "express-rate-limit";
import { requireAuth, requireOrganizationMembership, requireRole } from "../middleware/auth.js";
import { adminService } from "../services/admin.service.js";
import {
  activityQuery,
  employeeBody,
  inviteBody,
  invitationListQuery,
  memberListQuery,
  organizationSettingsBody,
  roleBody,
  statusBody,
  websiteIdsBody
} from "../validators/admin.validator.js";
import { HttpError } from "../utils/http-error.js";

export const adminRouter = express.Router();
const adminOnly = [requireAuth, requireOrganizationMembership, requireRole("admin")];
adminRouter.use(...adminOnly);

const invitationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user.user_id)
});

const sensitiveOperationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user.user_id)
});

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(422, result.error.issues.map((issue) => issue.message).join(" "), "VALIDATION_ERROR");
  }
  return result.data;
}

function endpoint(handler, statusCode = 200) {
  return async (req, res, next) => {
    try {
      const data = await handler(req);
      res.status(statusCode).json({
        success: true,
        message: data?.deliveryStatus === "failed"
          ? "Invitation was recorded, but email delivery failed. You can resend it."
          : "Operation completed successfully",
        data
      });
    } catch (error) {
      next(error);
    }
  };
}

const organizationId = (req) => req.organization.organization_id;
const actorId = (req) => req.user.user_id;

adminRouter.get("/overview", endpoint((req) => adminService.getOverview(organizationId(req))));

adminRouter.get("/users", endpoint((req) => {
  const query = parse(memberListQuery, req.query);
  return adminService.listMembers(organizationId(req), query);
}));

adminRouter.post("/users", sensitiveOperationLimiter, endpoint((req) => {
  const body = parse(employeeBody, req.body);
  return adminService.createEmployee(organizationId(req), actorId(req), body);
}, 201));

adminRouter.get("/users/:userId", endpoint((req) =>
  adminService.getMember(organizationId(req), req.params.userId)
));

adminRouter.post("/users/:userId/password", sensitiveOperationLimiter, endpoint((req) =>
  adminService.resetEmployeePassword(organizationId(req), actorId(req), req.params.userId)
));

adminRouter.patch("/users/:userId/role", sensitiveOperationLimiter, endpoint((req) => {
  const body = parse(roleBody, req.body);
  return adminService.changeMemberRole(organizationId(req), actorId(req), req.params.userId, body.role);
}));

adminRouter.patch("/users/:userId/status", sensitiveOperationLimiter, endpoint((req) => {
  const body = parse(statusBody, req.body);
  return adminService.changeMemberStatus(organizationId(req), actorId(req), req.params.userId, body.status);
}));

adminRouter.delete("/users/:userId", sensitiveOperationLimiter, endpoint((req) =>
  adminService.revokeMember(organizationId(req), actorId(req), req.params.userId)
));

adminRouter.post("/users/invite", invitationLimiter, endpoint((req) => {
  const body = parse(inviteBody, req.body);
  return adminService.createInvitation(organizationId(req), actorId(req), body);
}, 201));

adminRouter.get("/invitations", endpoint((req) => {
  const query = parse(invitationListQuery, req.query);
  return adminService.listInvitations(organizationId(req), query);
}));

adminRouter.get("/invitations/:invitationId", endpoint((req) =>
  adminService.getInvitation(organizationId(req), req.params.invitationId)
));

adminRouter.post("/invitations/:invitationId/resend", invitationLimiter, endpoint((req) =>
  adminService.resendInvitation(organizationId(req), actorId(req), req.params.invitationId)
));

adminRouter.delete("/invitations/:invitationId", sensitiveOperationLimiter, endpoint((req) =>
  adminService.revokeInvitation(organizationId(req), actorId(req), req.params.invitationId)
));

adminRouter.get("/website-access/:userId", endpoint((req) =>
  adminService.getWebsiteAccess(organizationId(req), req.params.userId)
));

adminRouter.put("/website-access/:userId", sensitiveOperationLimiter, endpoint((req) => {
  const body = parse(websiteIdsBody, req.body);
  return adminService.replaceWebsiteAccess(
    organizationId(req),
    actorId(req),
    req.params.userId,
    body.websiteIds
  );
}));

adminRouter.get("/websites", endpoint((req) => adminService.listWebsites(organizationId(req))));
adminRouter.get("/integrations", endpoint((req) => adminService.listIntegrations(organizationId(req))));

adminRouter.get("/organization", endpoint((req) =>
  adminService.getOrganizationSettings(organizationId(req))
));

adminRouter.patch("/organization", sensitiveOperationLimiter, endpoint((req) => {
  const body = parse(organizationSettingsBody, req.body);
  return adminService.updateOrganizationSettings(organizationId(req), actorId(req), body);
}));

adminRouter.get("/activity-logs", endpoint((req) => {
  const query = parse(activityQuery, req.query);
  return adminService.listActivity(organizationId(req), query);
}));
