import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { getGa4 } from "../../services/endpoints";
import { useWebsite, useDateRange } from "../../hooks/useAppContext";
import { useSession } from "../../hooks/useSession";
import QueryState from "../../components/ui/QueryState";
import { toNum, fmtInt, downloadCsv } from "../../utils/format";

const METRICS = {
  organic_sessions: { label: "Organic sessions", color: "#4285f4", axis: "left" },
  total_form_conversions: { label: "Form submissions", color: "#0b8043", axis: "right" },
};

export default function Ga4Page() {
  const { websiteId } = useWebsite();
  const { range } = useDateRange();
  const { permissions } = useSession();
  const [active, setActive] = useState(Object.keys(METRICS));

  const q = useQuery({ queryKey: ["ga4", "summary", websiteId, range], queryFn: () => getGa4(websiteId, range) });

  const rows = (q.data?.rows ?? []).map((r) => ({
    date: r.report_date,
    organic_sessions: toNum(r.organic_sessions),
    total_form_conversions: toNum(r.total_form_conversions),
  }));
  const sum = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
  const toggle = (k) => setActive((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]));

  return (
    <QueryState query={q} isEmpty={!rows.length}>
      <p className="mb-3 text-xs text-gray-500">
        Sessions are filtered to the GA4 "Organic Search" session default channel group. Form submissions count the
        configured form_submit events.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3">
        {Object.entries(METRICS).map(([k, m]) => {
          const on = active.includes(k);
          return (
            <button key={k} onClick={() => toggle(k)}
              className={`rounded-lg p-4 text-left ${on ? "text-white" : "bg-gray-100 text-gray-600"}`}
              style={on ? { backgroundColor: m.color } : undefined}>
              <div className="text-sm">{m.label}</div>
              <div className="text-2xl">{fmtInt(sum(k))}</div>
            </button>
          );
        })}
      </div>

      <div className="h-80 rounded-lg border bg-white p-3">
        <ResponsiveContainer>
          <LineChart data={rows}>
            <CartesianGrid vertical={false} stroke="#eee" />
            <XAxis dataKey="date" />
            <YAxis yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" />
            <Tooltip />
            {active.map((k) => (
              <Line key={k} dataKey={k} name={METRICS[k].label} stroke={METRICS[k].color}
                yAxisId={METRICS[k].axis} dot={false} strokeWidth={2} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {permissions.canExportReports && <div className="mt-4 flex justify-end">
        <button onClick={() => downloadCsv("ga4-summary.csv", rows)} className="rounded border px-3 py-1 text-sm">
          Export CSV
        </button>
      </div>}
      <table className="mt-2 w-full rounded-lg border bg-white text-sm">
        <thead className="bg-gray-50 text-left"><tr>
          <th className="p-2">Date</th><th className="p-2">Organic sessions</th><th className="p-2">Form submissions</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date} className="border-t">
              <td className="p-2">{r.date}</td><td className="p-2">{fmtInt(r.organic_sessions)}</td>
              <td className="p-2">{fmtInt(r.total_form_conversions)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </QueryState>
  );
}