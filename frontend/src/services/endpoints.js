import { api } from "./api";
import { apiUrl } from "./api";
import { download } from "./api";
const qs = (o = {}) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, v);
  });
  return p.toString();
};
const q = (r) => qs(r);

export const getMe = () => api("/auth/me");
export const logout = () => api("/auth/logout", { method: "POST" });
export const getWebsites = () => api("/websites");
export const getOverview = (id, r) => api(`/websites/${id}/overview?${q(r)}`);
export const getGsc = (id, r) => api(`/websites/${id}/gsc?${q(r)}`);
export const getGa4 = (id, r, reportType = "summary", dimensionType = "default_channel_group") =>
  api(`/websites/${id}/ga4?${qs({ ...r, reportType, dimensionType })}`);
export const getKeywords = (id) => api(`/websites/${id}/gsc/keywords`);
export const getKeywordReport = (id, params) => api(`/websites/${id}/keywords/report?${qs(params)}`);
export const addKeyword = (id, keyword) =>
  api(`/websites/${id}/gsc/keywords`, { method: "POST", body: JSON.stringify({ keyword }) });
export const getKeywordHistory = (id, kid, r) =>
  api(`/websites/${id}/gsc/keywords/${kid}/history?${q(r)}`);
export const syncKeywordHistory = (id, kid, r) =>
  api(`/websites/${id}/gsc/keywords/${kid}/history/sync`, { method: "POST", body: JSON.stringify(r) });
export const addWebsite = (body) => api("/websites", { method: "POST", body: JSON.stringify(body) });
export const syncWebsite = (id) => api(`/websites/${id}/sync`, { method: "POST" });
export const getSyncJobs = () => api("/sync-jobs");
export const getSyncStatus = () => api("/sync-jobs/status");
export const getSyncJob = (id) => api(`/sync-jobs/${id}`);
export const retrySyncJob = (id) => api(`/sync-jobs/${id}/retry`, { method: "POST" });
export const deleteKeyword = (id, kid) => api(`/websites/${id}/gsc/keywords/${kid}`, { method: "DELETE" });
const send = (method, body) => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

export const login = (body) => api("/auth/login", send("POST", body));
export const changePassword = (password) => api("/auth/change-password", send("POST", { password }));
export const googleLoginUrl = () => apiUrl("/auth/google");

export const adminOverview = () => api("/admin/overview");
export const adminUsers = (params) => api(`/admin/users?${qs(params)}`);
export const adminUser = (id) => api(`/admin/users/${id}`);
export const createEmployee = (body) => api("/admin/users", send("POST", body));
export const resetEmployeePassword = (id) => api(`/admin/users/${id}/password`, { method: "POST" });
export const setUserRole = (id, role) => api(`/admin/users/${id}/role`, send("PATCH", { role }));
export const setUserStatus = (id, status) => api(`/admin/users/${id}/status`, send("PATCH", { status }));
export const removeUser = (id) => api(`/admin/users/${id}`, { method: "DELETE" });
export const getWebsiteAccess = (id) => api(`/admin/website-access/${id}`);
export const setWebsiteAccess = (id, websiteIds) => api(`/admin/website-access/${id}`, send("PUT", { websiteIds }));
export const getInvitations = (params) => api(`/admin/invitations?${qs(params)}`);
export const createInvitation = (body) => api("/admin/users/invite", send("POST", body));
export const resendInvitation = (id) => api(`/admin/invitations/${id}/resend`, { method: "POST" });
export const revokeInvitation = (id) => api(`/admin/invitations/${id}`, { method: "DELETE" });
export const getAdminWebsites = () => api("/admin/websites");
export const getIntegrations = () => api("/admin/integrations");
export const getOrganization = () => api("/admin/organization");
export const updateOrganization = (body) => api("/admin/organization", send("PATCH", body));
export const getActivityLogs = (params) => api(`/admin/activity-logs?${qs(params)}`);
export const disconnectGoogle = () => api("/auth/disconnect-google", { method: "POST" });

export const getReportComparison = (id, params) => api(`/websites/${id}/reports/comparison?${qs(params)}`);
export const exportReport = (id, params) => download(`/websites/${id}/reports/export?${qs(params)}`);