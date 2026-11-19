import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { getGa4, getReportComparison, getWebsites } from "../../services/endpoints";
import { useWebsite, useDateRange } from "../../hooks/useAppContext";
import { useSession } from "../../hooks/useSession";
import QueryState from "../../components/ui/QueryState";
import { toNum, fmtInt, downloadCsv } from "../../utils/format";
import ComparisonGraph from "../../components/charts/ComparisonGraph";
import { exportExcelReport } from "../../utils/excel-chart-export";

const METRICS = {
  organic_sessions: { label: "Organic sessions", color: "#4285f4", axis: "left" },
  total_form_conversions: { label: "Form submissions", color: "#0b8043", axis: "right" },
};
const COMPARISON_METRICS = {
  ga4: [
    { key: "organic_sessions", label: "Organic sessions" },
    { key: "total_form_conversions", label: "Total form conversions" },
    { key: "form_submit_conversions", label: "form_submit events" },
    { key: "from_submit_conversions", label: "From_Submit events" }
  ],
  user_acquisition: [
    { key: "totalUsers", label: "Users" },
    { key: "newUsers", label: "New users" },
    { key: "activeUsers", label: "Active users" },
    { key: "engagedSessions", label: "Engaged sessions" },
    { key: "engagementRate", label: "Engagement rate" },
    { key: "averageSessionDuration", label: "Average session duration" },
    { key: "conversions", label: "Conversions" },
    { key: "totalRevenue", label: "Revenue" }
  ],
  traffic_acquisition: [
    { key: "sessions", label: "Sessions" },
    { key: "engagedSessions", label: "Engaged sessions" },
    { key: "engagementRate", label: "Engagement rate" }
  ]
};
const COMPARISON_MODES = [
  ["previous_period", "Previous period"],
  ["previous_week", "Previous week"],
  ["previous_month", "Previous month"],
  ["previous_year", "Previous year"],
  ["custom", "Custom range"]
];

export default function Ga4Page() {
  const { websiteId } = useWebsite();
  const { range } = useDateRange();
  const { permissions } = useSession();
  const [active, setActive] = useState(Object.keys(METRICS));
  const [comparisonSource, setComparisonSource] = useState("ga4");
  const [comparisonMetric, setComparisonMetric] = useState(COMPARISON_METRICS.ga4[0].key);
  const [comparisonMode, setComparisonMode] = useState("previous_period");
  const [customRange, setCustomRange] = useState({ startDate: "", endDate: "" });
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const sites = useQuery({ queryKey: ["websites"], queryFn: getWebsites, enabled: !!websiteId });
  const websiteName = sites.data?.websites?.find((w) => Number(w.website_id) === Number(websiteId))?.website_name || "Website";

  const onExportXlsx = async () => {
    setExportingXlsx(true);
    try {
      await exportExcelReport({
        websiteId,
        websiteName,
        source: "ga4",
        startDate: range.startDate,
        endDate: range.endDate,
        comparisonPeriod: comparisonQuery.data?.periods?.comparison,
        comparisonMode,
        reportResult: comparisonQuery.data || rows
      });
    } catch (e) {
      alert(e.message);
    } finally {
      setExportingXlsx(false);
    }
  };

  const q = useQuery({ queryKey: ["ga4", "summary", websiteId, range], queryFn: () => getGa4(websiteId, range) });

  const rows = (q.data?.rows ?? []).map((r) => ({
    date: r.report_date,
    organic_sessions: toNum(r.organic_sessions),
    total_form_conversions: toNum(r.total_form_conversions),
  }));
  const comparisonQuery = useQuery({
    queryKey: ["ga4-comparison", websiteId, range, comparisonSource, comparisonMetric, comparisonMode, customRange],
    queryFn: () => getReportComparison(websiteId, {
      source: comparisonSource,
      metrics: comparisonMetric,
      currentStartDate: range.startDate,
      currentEndDate: range.endDate,
      ...(comparisonMode === "custom"
        ? { compareStartDate: customRange.startDate, compareEndDate: customRange.endDate }
        : { comparisonMode }),
      ...(comparisonSource === "user_acquisition" || comparisonSource === "traffic_acquisition"
        ? { filters: JSON.stringify({ dimensionType: "default_channel_group" }) }
        : {})
    }),
    enabled: !!websiteId && (comparisonMode !== "custom" || !!customRange.startDate && !!customRange.endDate)
  });
  const comparison = comparisonQuery.data;
  const comparisonMetrics = COMPARISON_METRICS[comparisonSource];
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

      <section className="space-y-3 rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label>Comparison data
            <select value={comparisonSource} onChange={(event) => {
              const nextSource = event.target.value;
              setComparisonSource(nextSource);
              setComparisonMetric(COMPARISON_METRICS[nextSource][0].key);
            }} className="mt-1 block rounded border px-2 py-1">
              <option value="ga4">GA4 summary</option>
              <option value="user_acquisition">User Acquisition</option>
              <option value="traffic_acquisition">Traffic Acquisition</option>
            </select>
          </label>
          <label>Compare with
            <select value={comparisonMode} onChange={(event) => setComparisonMode(event.target.value)}
              className="mt-1 block rounded border px-2 py-1">
              {COMPARISON_MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {comparisonMode === "custom" && (
            <div className="flex items-end gap-2">
              <input type="date" value={customRange.startDate}
                onChange={(event) => setCustomRange({ ...customRange, startDate: event.target.value })}
                className="rounded border px-2 py-1" />
              <span>–</span>
              <input type="date" value={customRange.endDate}
                onChange={(event) => setCustomRange({ ...customRange, endDate: event.target.value })}
                className="rounded border px-2 py-1" />
            </div>
          )}
        </div>
        {comparisonQuery.error && <p className="text-sm text-red-700">{comparisonQuery.error.message}</p>}
        {!comparisonQuery.error && comparisonQuery.isLoading && <p className="text-sm text-gray-500">Loading comparison…</p>}
        {comparison && (
          <ComparisonGraph
            currentRows={comparison.data?.current ?? []}
            comparisonRows={comparison.data?.comparison ?? []}
            currentPeriod={comparison.periods?.current}
            comparisonPeriod={comparison.periods?.comparison}
            source={comparisonSource}
            metrics={comparisonMetrics}
            metric={comparisonMetric}
            onMetricChange={setComparisonMetric}
            currentLabel="Current"
            comparisonLabel="Comparison"
          />
        )}
        <p className="text-xs text-gray-500">
          These series come from stored GA4 SQL reports. User Acquisition uses first-user channel data; Traffic Acquisition uses session-scoped channel data. Metrics not stored by the backend are not plotted.
        </p>
      </section>

      {permissions.canExportReports && <div className="mt-4 flex justify-end gap-2">
        <button onClick={() => downloadCsv("ga4-summary.csv", rows)} className="rounded border px-3 py-1 text-sm">
          Export CSV
        </button>
        <button onClick={onExportXlsx} disabled={exportingXlsx} className="rounded border px-3 py-1 text-sm disabled:opacity-50">
          {exportingXlsx ? "Exporting…" : "Export Excel"}
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