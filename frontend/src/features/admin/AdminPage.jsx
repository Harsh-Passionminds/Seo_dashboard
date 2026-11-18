import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getWebsites, adminOverview, adminUsers, createEmployee, resetEmployeePassword, setUserRole, setUserStatus,
  removeUser, setWebsiteAccess, getOrganization, updateOrganization, getActivityLogs, getIntegrations, googleLoginUrl,
} from "../../services/endpoints";
import { useSession } from "../../hooks/useSession";
import QueryState from "../../components/ui/QueryState";

const TABS = ["Overview", "Members", "Organization", "Integrations", "Activity"];
const cell = (v) => (v && typeof v === "object" ? JSON.stringify(v) : String(v ?? ""));
const when = (v) => (v ? new Date(v).toLocaleString() : "—");

function TempPassword({ temp, onClose }) {
  if (!temp) return null;
  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
      <p className="font-medium">Temporary password for {temp.label}</p>
      <p className="my-2 select-all rounded bg-white px-3 py-2 font-mono">{temp.password || "(not returned)"}</p>
      <p className="text-xs text-gray-600">Copy it now and give it to the employee securely. It is shown only once.</p>
      <button onClick={onClose} className="mt-2 rounded border bg-white px-3 py-1 text-xs">Done</button>
    </div>
  );
}

function Members() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ search: "", role: "", status: "", page: 1 });
  const [temp, setTemp] = useState(null);
  const [access, setAccess] = useState(null);
  const [form, setForm] = useState({ name: "", username: "", password: "", role: "analyst", websiteIds: [] });
  const [formErr, setFormErr] = useState("");
  const params = { ...filters, limit: 10 };

  const list = useQuery({ queryKey: ["admin-users", params], queryFn: () => adminUsers(params), placeholderData: (p) => p });
  const sites = useQuery({ queryKey: ["websites"], queryFn: getWebsites });
  const siteList = sites.data?.websites ?? [];
  const users = list.data?.data?.data ?? [];
  const pg = list.data?.data?.pagination;
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  const act = useMutation({
    mutationFn: ({ fn }) => fn(),
    onSuccess: (res, vars) => { refresh(); vars.after?.(res); },
  });
  const run = (fn, after) => act.mutate({ fn, after });

  const create = useMutation({
    mutationFn: () => createEmployee({
      name: form.name.trim(), username: form.username.trim(), role: form.role,
      websiteIds: form.websiteIds, ...(form.password ? { password: form.password } : {}),
    }),
    onSuccess: (res) => {
      refresh();
      setFilters({ search: "", role: "", status: "", page: 1 });
      if (res?.data?.temporaryPassword) setTemp({ label: form.username, password: res.data.temporaryPassword });
      setForm({ name: "", username: "", password: "", role: "analyst", websiteIds: [] });
    },
  });

  const submitCreate = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setFormErr("Name is required.");
    if (!/^[A-Za-z0-9._-]{3,50}$/.test(form.username.trim())) return setFormErr("Username: 3–50 characters (letters, numbers, . _ -).");
    if (form.password && form.password.length < 12) return setFormErr("Password must be at least 12 characters (or leave it empty).");
    if (!form.websiteIds.length) return setFormErr("Select at least one website.");
    setFormErr("");
    create.mutate();
  };

  const toggleSite = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div className="space-y-6">
      <TempPassword temp={temp} onClose={() => setTemp(null)} />

      <section>
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          <input value={filters.search} placeholder="Search name or username"
            onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
            className="rounded border px-3 py-1.5" />
          <select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value, page: 1 })}
            className="rounded border px-2 py-1.5">
            <option value="">All roles</option><option value="admin">Admin</option>
            <option value="analyst">Analyst</option><option value="viewer">Viewer</option>
          </select>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}
            className="rounded border px-2 py-1.5">
            <option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
          </select>
        </div>
        {act.error && <p className="mb-2 text-sm text-red-700">{act.error.message}</p>}
        {sites.error && <p className="mb-2 text-sm text-red-700">{sites.error.message}</p>}

        <QueryState query={list} isEmpty={!users.length} emptyText="No members found.">
          <div className="overflow-x-auto">
            <table className="w-full rounded-lg border bg-white text-sm">
              <thead className="bg-gray-50 text-left"><tr>
                <th className="p-2">Name</th><th className="p-2">Username / email</th><th className="p-2">Role</th>
                <th className="p-2">Status</th><th className="p-2">Websites</th><th className="p-2">Last login</th><th className="p-2" />
              </tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t align-top">
                    <td className="p-2">{u.name}</td>
                    <td className="p-2">{u.username || u.email}</td>
                    <td className="p-2">
                      {u.isEmployeeAccount ? (
                        <select value={u.role} onChange={(e) => run(() => setUserRole(u.id, e.target.value))}
                          className="rounded border px-1 py-0.5">
                          <option value="analyst">analyst</option><option value="viewer">viewer</option>
                        </select>
                      ) : u.role}
                    </td>
                    <td className="p-2">{u.status}</td>
                    <td className="p-2">{u.role === "admin" ? "All" : (u.assignedWebsiteIds ?? []).length}</td>
                    <td className="p-2">{when(u.lastLoginAt)}</td>
                    <td className="space-x-2 whitespace-nowrap p-2 text-xs">
                      {u.isEmployeeAccount && (
                        <>
                          <button disabled={act.isPending || sites.isLoading || sites.isError}
                            onClick={() => setAccess({ user: u, ids: u.assignedWebsiteIds ?? [] })} className="text-blue-600 disabled:opacity-50">Websites</button>
                          <button onClick={() => {
                            if (window.confirm(`Reset the password for ${u.username}?`))
                              run(() => resetEmployeePassword(u.id), (r) => setTemp({ label: u.username, password: r?.data?.temporaryPassword }));
                          }} disabled={act.isPending} className="text-blue-600 disabled:opacity-50">Reset password</button>
                        </>
                      )}
                      <button onClick={() => run(() => setUserStatus(u.id, u.status === "active" ? "inactive" : "active"))}
                        disabled={act.isPending} className="text-blue-600 disabled:opacity-50">{u.status === "active" ? "Deactivate" : "Activate"}</button>
                      <button onClick={() => {
                        if (window.confirm(`Remove ${u.name} from the organization? Their access and sessions are revoked.`))
                          run(() => removeUser(u.id));
                      }} disabled={act.isPending} className="text-red-600 disabled:opacity-50">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pg && (
            <div className="mt-3 flex items-center gap-3 text-sm">
              <button disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
                className="rounded border px-3 py-1 disabled:opacity-50">Previous</button>
              <span>Page {pg.page} of {Math.max(1, Math.ceil(pg.total / pg.limit))} ({pg.total} members)</span>
              <button disabled={pg.page * pg.limit >= pg.total} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
                className="rounded border px-3 py-1 disabled:opacity-50">Next</button>
            </div>
          )}
        </QueryState>
      </section>

      {access && (
        <section className="rounded-lg border bg-white p-4">
          <h3 className="mb-2 font-medium">Website access: {access.user.username}</h3>
          <div className="grid gap-1 md:grid-cols-2">
            {siteList.map((w) => (
              <label key={w.website_id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={access.ids.includes(w.website_id)}
                  onChange={() => setAccess({ ...access, ids: toggleSite(access.ids, w.website_id) })} />
                {w.website_name}
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => run(() => setWebsiteAccess(access.user.id, access.ids), () => setAccess(null))}
              disabled={act.isPending || sites.isError || sites.isLoading}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white">Save</button>
            <button onClick={() => setAccess(null)} className="rounded border px-3 py-1 text-sm">Cancel</button>
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3 text-lg font-medium">Create employee account</h3>
        <form onSubmit={submitCreate} className="grid max-w-xl gap-3 rounded-lg border bg-white p-4 text-sm">
          <input value={form.name} placeholder="Full name" onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded border px-3 py-1.5" />
          <input value={form.username} placeholder="Username" onChange={(e) => setForm({ ...form, username: e.target.value })}
            className="rounded border px-3 py-1.5" />
          <input type="password" value={form.password} autoComplete="new-password"
            placeholder="Initial password (optional, leave empty to generate one)"
            onChange={(e) => setForm({ ...form, password: e.target.value })} className="rounded border px-3 py-1.5" />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="rounded border px-2 py-1.5">
            <option value="analyst">Analyst</option><option value="viewer">Viewer</option>
          </select>
          <div>
            <div className="mb-1 text-gray-600">Websites this employee can view</div>
            {sites.isLoading && <p className="text-gray-500">Loading websites…</p>}
            {!sites.isLoading && !sites.error && !siteList.length && <p className="text-gray-500">Add a website before creating employee accounts.</p>}
            <div className="grid gap-1 md:grid-cols-2">
              {siteList.map((w) => (
                <label key={w.website_id} className="flex items-center gap-2">
                  <input type="checkbox" checked={form.websiteIds.includes(w.website_id)}
                    onChange={() => setForm({ ...form, websiteIds: toggleSite(form.websiteIds, w.website_id) })} />
                  {w.website_name}
                </label>
              ))}
            </div>
          </div>
          {(formErr || create.error) && <p className="text-red-700">{formErr || create.error.message}</p>}
          <button disabled={create.isPending || sites.isLoading || !!sites.error || !siteList.length}
            className="w-fit rounded bg-blue-600 px-4 py-2 text-white">
            {create.isPending ? "Creating…" : "Create account"}
          </button>
        </form>
      </section>
    </div>
  );
}

function Organization() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-org"], queryFn: getOrganization });
  const org = q.data?.data;
  const [f, setF] = useState(null);
  const values = f ?? (org ? {
      name: org.name ?? "", defaultTimezone: org.defaultTimezone ?? "UTC",
      reportExportsEnabled: !!org.reportExportsEnabled, viewerExportsEnabled: !!org.viewerExportsEnabled,
      invitationExpiryHours: org.invitationExpiryHours ?? 72,
    } : null);

  const save = useMutation({
    mutationFn: () => updateOrganization({ ...values, invitationExpiryHours: Number(values.invitationExpiryHours) }),
    onSuccess: () => {
      setF(null);
      qc.invalidateQueries({ queryKey: ["admin-org"] });
    },
  });

  return (
    <QueryState query={q} isEmpty={!values}>
      {values && (
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
          className="grid max-w-xl gap-3 rounded-lg border bg-white p-4 text-sm">
          <label>Organization name
            <input value={values.name} onChange={(e) => setF({ ...values, name: e.target.value })} className="mt-1 w-full rounded border px-3 py-1.5" />
          </label>
          <label>Default timezone
            <input value={values.defaultTimezone} onChange={(e) => setF({ ...values, defaultTimezone: e.target.value })} className="mt-1 w-full rounded border px-3 py-1.5" />
          </label>
          <label>Invitation expiry (hours, 1–720)
            <input type="number" min="1" max="720" value={values.invitationExpiryHours}
              onChange={(e) => setF({ ...values, invitationExpiryHours: e.target.value })} className="mt-1 w-full rounded border px-3 py-1.5" />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={values.reportExportsEnabled} onChange={(e) => setF({ ...values, reportExportsEnabled: e.target.checked })} />
            Analysts can export reports
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={values.viewerExportsEnabled} onChange={(e) => setF({ ...values, viewerExportsEnabled: e.target.checked })} />
            Viewers can export reports
          </label>
          {save.error && <p className="text-red-700">{save.error.message}</p>}
          {save.isSuccess && <p className="text-green-700">Settings saved.</p>}
          <button disabled={save.isPending} className="w-fit rounded bg-blue-600 px-4 py-2 text-white">
            {save.isPending ? "Saving…" : "Save settings"}
          </button>
        </form>
      )}
    </QueryState>
  );
}

function AdminOverview() {
  const q = useQuery({ queryKey: ["admin-overview"], queryFn: adminOverview });
  const overview = q.data?.data;
  const stats = overview ? [
    ["Members", `${overview.members.active} active / ${overview.members.total} total`],
    ["Pending invitations", overview.pendingInvitations],
    ["Websites", overview.totalWebsites],
    ["Connected Google integrations", overview.connectedGoogleIntegrations],
  ] : [];
  const latest = overview?.latestSynchronization;

  return (
    <QueryState query={q} isEmpty={!overview}>
      {overview && (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {stats.map(([label, value]) => (
              <div key={label} className="rounded-lg border bg-white p-4">
                <div className="text-sm text-gray-500">{label}</div>
                <div className="mt-1 text-xl font-semibold">{value}</div>
              </div>
            ))}
          </div>
          <section className="rounded-lg border bg-white p-4">
            <h2 className="mb-2 font-medium">Latest synchronization</h2>
            {latest ? (
              <p className="text-sm text-gray-600">
                {latest.website_name} · {latest.source} / {latest.report_type} · {latest.status}
                {latest.completed_at ? ` · ${when(latest.completed_at)}` : ""}
                {latest.error_message ? ` · ${latest.error_message}` : ""}
              </p>
            ) : <p className="text-sm text-gray-600">No synchronization has run yet.</p>}
          </section>
          <section>
            <h2 className="mb-2 font-medium">Recent activity</h2>
            {overview.recentActivities.length ? (
              <div className="overflow-x-auto">
                <table className="w-full rounded-lg border bg-white text-sm">
                  <thead className="bg-gray-50 text-left"><tr>
                    <th className="p-2">Actor</th><th className="p-2">Action</th><th className="p-2">Resource</th><th className="p-2">When</th>
                  </tr></thead>
                  <tbody>
                    {overview.recentActivities.map((row) => (
                      <tr key={row.activity_id} className="border-t">
                        <td className="p-2">{row.actor_name ?? "System"}</td>
                        <td className="p-2">{row.action}</td>
                        <td className="p-2">{row.resource_type}{row.resource_id ? ` · ${row.resource_id}` : ""}</td>
                        <td className="p-2">{when(row.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-gray-600">No recent activity.</p>}
          </section>
        </div>
      )}
    </QueryState>
  );
}

function Integrations() {
  const q = useQuery({ queryKey: ["admin-integrations"], queryFn: getIntegrations });
  const integrations = q.data?.data ?? [];

  return (
    <div className="space-y-4">
      <section className="rounded-lg border bg-white p-4">
        <h2 className="font-medium">Google Analytics and Search Console</h2>
        <p className="my-2 text-sm text-gray-600">
          Connect using the Admin Google account authorized for the website properties. Analytics reports use synchronized data stored by the backend.
        </p>
        <button onClick={() => window.location.assign(googleLoginUrl())}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
          Connect or refresh Google account
        </button>
      </section>
      <QueryState query={q} isEmpty={!integrations.length} emptyText="No websites are configured for Google integrations.">
        <div className="overflow-x-auto">
          <table className="w-full rounded-lg border bg-white text-sm">
            <thead className="bg-gray-50 text-left"><tr>
              <th className="p-2">Website</th><th className="p-2">Properties</th><th className="p-2">Connection</th><th className="p-2">Last successful sync</th>
            </tr></thead>
            <tbody>
              {integrations.map((item) => (
                <tr key={item.websiteId} className="border-t align-top">
                  <td className="p-2">{item.websiteName}<div className="text-xs text-gray-500">{item.domainName}</div></td>
                  <td className="p-2">GA4: {item.ga4PropertyId || "Not set"}<br />GSC: {item.gscPropertyUrl || "Not set"}</td>
                  <td className="p-2">
                    <div>{item.connected ? "Connected" : "Not connected"}</div>
                    <div className="text-xs text-gray-500">{item.connectedGoogleAccount || item.connectionOwner?.email || "No account"}</div>
                    {item.connectionError && <div className="mt-1 text-xs text-red-700">{item.connectionError}</div>}
                  </td>
                  <td className="p-2">{when(item.lastSuccessfulSync)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
    </div>
  );
}

function ActivityLog() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const params = { page, limit: 25, order: "desc", action };
  const q = useQuery({ queryKey: ["admin-activity", params], queryFn: () => getActivityLogs(params), placeholderData: (p) => p });
  const rows = q.data?.data?.data ?? [];
  const pg = q.data?.data?.pagination;

  return (
    <div>
      <input value={action} placeholder="Filter by action" onChange={(e) => { setAction(e.target.value); setPage(1); }}
        className="mb-3 rounded border px-3 py-1.5 text-sm" />
      <QueryState query={q} isEmpty={!rows.length} emptyText="No activity found.">
        <div className="overflow-x-auto">
          <table className="w-full rounded-lg border bg-white text-sm">
            <thead className="bg-gray-50 text-left"><tr>{Object.keys(rows[0] ?? {}).map((k) => <th key={k} className="p-2">{k}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id ?? i} className="border-t align-top">
                  {Object.values(r).map((v, j) => <td key={j} className="max-w-xs break-words p-2">{cell(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pg && (
          <div className="mt-3 flex items-center gap-3 text-sm">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border px-3 py-1 disabled:opacity-50">Previous</button>
            <span>Page {pg.page} of {Math.max(1, Math.ceil(pg.total / pg.limit))}</span>
            <button disabled={pg.page * pg.limit >= pg.total} onClick={() => setPage(page + 1)} className="rounded border px-3 py-1 disabled:opacity-50">Next</button>
          </div>
        )}
      </QueryState>
    </div>
  );
}

export default function AdminPage() {
  const { isAdmin } = useSession();
  const [tab, setTab] = useState(TABS[0]);
  if (!isAdmin) return <p className="text-sm text-gray-600">Only administrators can open this page.</p>;

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2 text-sm ${tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-gray-600"}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Overview" && <AdminOverview />}
      {tab === "Members" && <Members />}
      {tab === "Organization" && <Organization />}
      {tab === "Integrations" && <Integrations />}
      {tab === "Activity" && <ActivityLog />}
    </div>
  );
}