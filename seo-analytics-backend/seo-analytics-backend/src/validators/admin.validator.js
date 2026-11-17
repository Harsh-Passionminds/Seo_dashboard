import { z } from "zod";

const roles = ["admin", "analyst", "viewer"];
const statuses = ["active", "inactive", "revoked", "pending", "accepted", "expired"];
const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);
const idList = z.array(z.coerce.number().int().positive()).max(500);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Date must be a valid YYYY-MM-DD date.");

export const memberListQuery = z.object({
  search: z.string().trim().max(200).default(""),
  role: z.enum(roles).optional(),
  status: z.enum(["active", "inactive", "revoked"]).optional(),
  page,
  limit,
  sortBy: z.enum(["name", "email", "role", "status", "joined_at"]).default("joined_at"),
  order: z.enum(["asc", "desc"]).default("desc")
}).strict();

export const roleBody = z.object({ role: z.enum(roles) }).strict();
export const statusBody = z.object({ status: z.enum(["active", "inactive"]) }).strict();
export const employeeBody = z.object({
  name: z.string().trim().min(1).max(255),
  username: z.string().trim().min(3).max(50).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Username may contain letters, numbers, dots, underscores, and hyphens."),
  password: z.string().min(12).max(72).optional(),
  role: z.enum(["analyst", "viewer"]),
  websiteIds: idList.min(1)
}).strict();

export const inviteBody = z.object({
  email: z.string().trim().email().max(320),
  role: z.literal("admin"),
  websiteIds: idList.default([])
}).strict();

export const invitationListQuery = z.object({
  status: z.enum(statuses).optional(),
  page,
  limit
}).strict();

export const websiteIdsBody = z.object({ websiteIds: idList }).strict();
export const invitationTokenBody = z.object({ token: z.string().min(20).max(200) }).strict();

export const organizationSettingsBody = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  defaultTimezone: z.string().trim().min(1).max(64).refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "defaultTimezone must be a valid IANA timezone.").optional(),
  reportExportsEnabled: z.boolean().optional(),
  viewerExportsEnabled: z.boolean().optional(),
  invitationExpiryHours: z.number().int().min(1).max(720).optional()
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one supported setting.");

export const activityQuery = z.object({
  actorUserId: z.string().regex(/^\d+$/).optional(),
  action: z.string().trim().max(100).optional().default(""),
  resourceType: z.string().trim().max(100).optional().default(""),
  startDate: calendarDate.optional(),
  endDate: calendarDate.optional(),
  page,
  limit,
  order: z.enum(["asc", "desc"]).default("desc")
}).strict().refine((value) => !value.startDate || !value.endDate || value.startDate <= value.endDate, {
  message: "startDate must be on or before endDate."
});
