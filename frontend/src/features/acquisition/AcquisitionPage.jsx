import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from "recharts";
import { getGa4 } from "../../services/endpoints";
import { useWebsite, useDateRange } from "../../hooks/useAppContext";
import { useSession } from "../../hooks/useSession";
import QueryState from "../../components/ui/QueryState";
import { toNum, fmtInt, fmtPct, downloadCsv } from "../../utils/format";

const TABS = ["User Acquisition", "Traffic Acquisition", "Visitor Entry"];

function Traffic({ dim }) {
  const { websiteId } = useWebsite();
  const { range } = useDateRange();
  const { permissions } = useSession();
  const q = useQuery({
    queryKey: ["ga4", "traffic", websiteId, range, dim],
    queryFn: () => getGa4(websiteId, range, "traffic_acquisition", dim),
  });
  const rows = (q.data?.rows ?? []).map((r) => ({
    name: r.dimensionValue ?? "(not set)",
    sessions: toNum(r.sessions),
    engaged: toNum(r.engagedSessions),
  }));
  const total = q.data?.total;

  return (
    <QueryState query={q} isEmpty={!rows.length}>
      <p className="mb-3 text-xs text-gray-500">Session-scoped dimensions (how sessions arrived), aggregated over the selected range.</p>
      <div className="h-72 rounded-lg border bg-white p-3">
        <ResponsiveContainer>
          <BarChart data={rows}>
            <CartesianGrid vertical={false} stroke="#eee" />
            <XAxis dataKey="name" /><YAxis /><Tooltip />
            <Bar dataKey="sessions" fill="#4285f4" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {permissions.canExportReports && <div className="mt-3 flex justify-end">
        <button onClick={() => downloadCsv("traffic-acquisition.csv", rows)} className="rounded border px-3 py-1 text-sm">Export CSV</button>
      </div>}
      <table className="mt-2 w-full rounded-lg border bg-white text-sm">
        <thead className="bg-gray-50 text-left"><tr>
          <th className="p-2">{dim === "source_medium" ? "Source / medium" : "Channel group"}</th>
          <th className="p-2">Sessions</th><th className="p-2">Share</th>
          <th className="p-2">Engaged sessions</th><th className="p-2">Engaged rate</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t">
              <td className="p-2">{r.name}</td>
              <td className="p-2">{fmtInt(r.sessions)}</td>
              <td className="p-2">{total?.sessions ? fmtPct(r.sessions / total.sessions) : "—"}</td>
              <td className="p-2">{fmtInt(r.engaged)}</td>
              <td className="p-2">{r.sessions ? fmtPct(r.engaged / r.sessions) : "—"}</td>
            </tr>
          ))}
          {total && (
            <tr className="border-t bg-gray-50 font-medium">
              <td className="p-2">Total</td><td className="p-2">{fmtInt(total.sessions)}</td><td />
              <td className="p-2">{fmtInt(total.engagedSessions)}</td><td />
            </tr>
          )}
        </tbody>
      </table>
    </QueryState>
  );
}

function User({ dim }) {
  const { websiteId } = useWebsite();
  const { range } = useDateRange();
  const { permissions } = useSession();
  const q = useQuery({
    queryKey: ["ga4", "user", websiteId, range, dim],
    queryFn: () => getGa4(websiteId, range, "user_acquisition", dim),
  });
  const raw = q.data?.rows ?? [];

  const byDim = {};
  const byDate = {};
  raw.forEach((r) => {
    const m = r.metrics ?? {};
    const k = r.dimensionValue ?? "(not set)";
    const a = (byDim[k] ??= {
      name: k, totalUsers: 0, newUsers: 0, activeUsers: 0, engagedSessions: 0, conversions: 0, totalRevenue: 0
    });
    a.totalUsers += toNum(m.totalUsers) ?? 0;
    a.newUsers += toNum(m.newUsers) ?? 0;
    a.activeUsers += toNum(m.activeUsers) ?? 0;
    a.engagedSessions += toNum(m.engagedSessions) ?? 0;
    a.conversions += toNum(m.conversions) ?? 0;
    a.totalRevenue += toNum(m.totalRevenue) ?? 0;
    byDate[r.date] = (byDate[r.date] ?? 0) + (toNum(m.totalUsers) ?? 0);
  });
  const table = Object.values(byDim).sort((a, b) => b.totalUsers - a.totalUsers);
  const trend = Object.entries(byDate).map(([date, totalUsers]) => ({ date, totalUsers })).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <QueryState query={q} isEmpty={!raw.length}>
      <p className="mb-3 text-xs text-gray-500">
        First-user dimensions (how users first discovered the site). Users are summed from daily rows, so totals are
        not distinct users for the whole range.
      </p>
      <div className="h-64 rounded-lg border bg-white p-3">
        <ResponsiveContainer>
          <LineChart data={trend}>
            <CartesianGrid vertical={false} stroke="#eee" />
            <XAxis dataKey="date" /><YAxis /><Tooltip />
            <Line dataKey="totalUsers" name="Users (daily)" stroke="#5e35b1" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {permissions.canExportReports && <div className="mt-3 flex justify-end">
        <button onClick={() => downloadCsv("user-acquisition.csv", table)} className="rounded border px-3 py-1 text-sm">Export CSV</button>
      </div>}
      <table className="mt-2 w-full rounded-lg border bg-white text-sm">
        <thead className="bg-gray-50 text-left"><tr>
          <th className="p-2">{dim === "source_medium" ? "First user source / medium" : "First user channel group"}</th>
          <th className="p-2">Users (summed daily)</th><th className="p-2">New users (summed daily)</th>
          <th className="p-2">Active users (summed daily)</th><th className="p-2">Engaged sessions</th>
          <th className="p-2">Conversions</th><th className="p-2">Revenue</th>
        </tr></thead>
        <tbody>
          {table.map((r) => (
            <tr key={r.name} className="border-t">
              <td className="p-2">{r.name}</td><td className="p-2">{fmtInt(r.totalUsers)}</td>
              <td className="p-2">{fmtInt(r.newUsers)}</td><td className="p-2">{fmtInt(r.activeUsers)}</td>
              <td className="p-2">{fmtInt(r.engagedSessions)}</td><td className="p-2">{fmtInt(r.conversions)}</td>
              <td className="p-2">{r.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </QueryState>
  );
}

export default function AcquisitionPage() {
  const [tab, setTab] = useState(TABS[0]);
  const [dim, setDim] = useState("default_channel_group");

  return (
    <div>
      <div className="mb-4 flex items-center justify-between border-b">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`border-b-2 px-4 py-2 text-sm ${tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-gray-600"}`}>
              {t}
            </button>
          ))}
        </div>
        {tab !== "Visitor Entry" && (
          <select value={dim} onChange={(e) => setDim(e.target.value)} className="mb-1 rounded border px-2 py-1 text-sm">
            <option value="default_channel_group">Channel group</option>
            <option value="source_medium">Source / medium</option>
          </select>
        )}
      </div>

      {tab === "User Acquisition" && <User dim={dim} />}
      {tab === "Traffic Acquisition" && <Traffic dim={dim} />}
      {tab === "Visitor Entry" && (
        <div className="rounded-lg border bg-white p-6 text-sm text-gray-600">
          Visitor Entry (landing pages) is not available yet. The backend has no landing-page endpoint.
        </div>
      )}
    </div>
  );
}