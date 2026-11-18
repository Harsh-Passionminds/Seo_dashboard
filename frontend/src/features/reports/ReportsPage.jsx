import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { exportReport, getReportComparison, getKeywords } from "../../services/endpoints";
import { useWebsite, useDateRange } from "../../hooks/useAppContext";
import { useSession } from "../../hooks/useSession";
import { toNum } from "../../utils/format";
import { buildReportChartSeries } from "../../utils/report-series";

const SOURCES = [
  ["gsc", "Search Console"],
  ["ga4", "GA4 organic sessions and forms"],
  ["user_acquisition", "User Acquisition"],
  ["traffic_acquisition", "Traffic Acquisition"],
  ["keyword_tracking", "Keyword Tracking"],
  ["combined", "Combined (GSC + GA4)"],
];
const MODES = [
  ["previous_period", "Previous period"],
  ["previous_week", "Previous week"],
  ["previous_month", "Previous month"],
  ["previous_year", "Previous year"],
  ["custom", "Custom range"],
];
const isPct = (k) => /ctr|rate/i.test(k);
const lowerBetter = (k) => /position/i.test(k);
const fmt = (k, v) => {
  const n = toNum(v);
  if (n == null) return "No data";
  if (isPct(k) && Math.abs(n) <= 1) return (n * 100).toFixed(2) + "%";
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2);
};
const cell = (v) => (v && typeof v === "object" ? JSON.stringify(v) : v ?? "No data");

export default function ReportsPage() {
  const { websiteId } = useWebsite();
  const { range } = useDateRange();
  const { permissions } = useSession();

  const [source, setSource] = useState("gsc");
  const [mode, setMode] = useState("previous_period");
  const [cmp, setCmp] = useState({ startDate: "", endDate: "" });
  const [dimType, setDimType] = useState("default_channel_group");
  const [keywordId, setKeywordId] = useState("");
  const [picked, setPicked] = useState([]);
  const [chartMetric, setChartMetric] = useState("");
  const [view, setView] = useState("current");
  const [err, setErr] = useState("");
  const [exporting, setExporting] = useState("");
  const [generatedFor, setGeneratedFor] = useState(null);
  const reportContextKey = JSON.stringify({
    websiteId,
    source,
    mode,
    range,
    cmp: mode === "custom" ? cmp : null,
    dimType: source === "user_acquisition" || source === "traffic_acquisition" ? dimType : null,
    keywordId: source === "keyword_tracking" ? keywordId : null,
  });
  const currentContext = useRef(reportContextKey);
  useEffect(() => {
    currentContext.current = reportContextKey;
  }, [reportContextKey]);

  const kw = useQuery({
    queryKey: ["keywords", websiteId],
    queryFn: () => getKeywords(websiteId),
    enabled: !!websiteId && source === "keyword_tracking",
  });
  const kwList = kw.data?.keywords ?? [];

  const filters = () => {
    const f = {};
    if (source === "user_acquisition" || source === "traffic_acquisition") f.dimensionType = dimType;
    if (source === "keyword_tracking" && keywordId) f.keywordId = Number(keywordId);
    return Object.keys(f).length ? JSON.stringify(f) : undefined;
  };

  const gen = useMutation({
    mutationFn: ({ requestWebsiteId, params }) => getReportComparison(requestWebsiteId, params),
    onSuccess: (res, variables) => {
      setGeneratedFor(variables.contextKey);
      if (variables.contextKey !== currentContext.current) return;
      const keys = Object.keys(res.summary ?? {});
      if (!picked.length) setPicked(keys);
      if (!chartMetric || !keys.includes(chartMetric)) setChartMetric(keys[0] ?? "");
    },
  });

  const onGenerate = () => {
    if (source === "keyword_tracking" && !keywordId) return setErr("Select a keyword.");
    if (mode === "custom" && (!cmp.startDate || !cmp.endDate)) return setErr("Pick both comparison dates.");
    setErr("");
    const params = { source, currentStartDate: range.startDate, currentEndDate: range.endDate };
    if (mode === "custom") { params.compareStartDate = cmp.startDate; params.compareEndDate = cmp.endDate; }
    else params.comparisonMode = mode;
    if (picked.length) params.metrics = picked.join(",");
    const f = filters();
    if (f) params.filters = f;
    gen.mutate({ requestWebsiteId: websiteId, params, contextKey: reportContextKey });
  };

  const changeSource = (s) => { setSource(s); setPicked([]); setChartMetric(""); gen.reset(); };

  const exportFile = async (format) => {
    setExporting(format);
    setErr("");
    try {
      const p = { source, startDate: range.startDate, endDate: range.endDate, format };
      if (picked.length) p.metrics = picked.join(",");
      const f = filters();
      if (f) p.filters = f;
      await exportReport(websiteId, p);
    } catch (e) {
      setErr(e.message);
    } finally {
      setExporting("");
    }
  };

  const res = generatedFor === reportContextKey ? gen.data : null;
  const summary = res?.summary ?? {};
  const keys = Object.keys(summary);
  const cur = res?.data?.current ?? [];
  const prev = res?.data?.comparison ?? [];
  const hasDates = cur.some((row) => row.date) || prev.some((row) => row.date);
  const chart = buildReportChartSeries({
    currentRows: cur,
    comparisonRows: prev,
    currentPeriod: res?.periods?.current,
    comparisonPeriod: res?.periods?.comparison,
    metric: chartMetric,
    source
  });
  const chartData = hasDates ? chart.data : [];
  const chartMaxDay = chart.maxDay;
  const currentError = gen.error && gen.variables?.contextKey === reportContextKey ? gen.error : null;
  const tableRows = view === "current" ? cur : prev;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-1 text-lg font-medium">Build a report</h2>
        <p className="mb-4 text-sm text-gray-500">
          Current period: {range.startDate} → {range.endDate} (change it in the top bar)
        </p>

        <div className="grid gap-3 text-sm md:grid-cols-2">
          <label>Report section
            <select value={source} onChange={(e) => changeSource(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5">
              {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>Compare with
            <select value={mode} onChange={(e) => setMode(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5">
              {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          {mode === "custom" && (
            <div className="flex items-end gap-2 md:col-span-2">
              <input type="date" value={cmp.startDate} onChange={(e) => setCmp({ ...cmp, startDate: e.target.value })} className="rounded border px-2 py-1.5" />
              <span>–</span>
              <input type="date" value={cmp.endDate} onChange={(e) => setCmp({ ...cmp, endDate: e.target.value })} className="rounded border px-2 py-1.5" />
              <span className="text-xs text-gray-500">Must not overlap the current period.</span>
            </div>
          )}

          {(source === "user_acquisition" || source === "traffic_acquisition") && (
            <label>Group by
              <select value={dimType} onChange={(e) => setDimType(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5">
                <option value="default_channel_group">Channel group</option>
                <option value="source_medium">Source / medium</option>
              </select>
            </label>
          )}
          {source === "keyword_tracking" && (
            <label>Keyword
              <select value={keywordId} onChange={(e) => setKeywordId(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5">
                <option value="">Select a keyword</option>
                {kwList.map((k) => <option key={k.keyword_id} value={k.keyword_id}>{k.keyword}</option>)}
              </select>
            </label>
          )}
        </div>

        {mode !== "previous_period" && mode !== "custom" && (
          <p className="mt-3 text-xs text-gray-500">
            Week, month and year comparisons need a matching current range (a Monday-start week, a range starting on the 1st of a
            month, or one starting on January 1). Otherwise the backend rejects it with a message.
          </p>
        )}

        {keys.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-sm font-medium">Metrics to include</div>
            <div className="flex flex-wrap gap-4 text-sm">
              {keys.map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <input type="checkbox" checked={picked.includes(k)}
                    onChange={() => setPicked(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k])} />
                  {k}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500">Change the selection, then click Update report. Exports use the same selection.</p>
          </div>
        )}

        {(err || currentError) && <p className="mt-3 text-sm text-red-700">{err || currentError.message}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={onGenerate} disabled={gen.isPending || !websiteId} className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
            {gen.isPending ? "Generating…" : res ? "Update report" : "Generate report"}
          </button>
          <button onClick={() => exportFile("csv")} disabled={!!exporting || !permissions.canExportReports}
            className="rounded border px-4 py-2 text-sm disabled:opacity-50">
            {exporting === "csv" ? "Exporting…" : "Export CSV"}
          </button>
          <button onClick={() => exportFile("xlsx")} disabled={!!exporting || !permissions.canExportReports}
            className="rounded border px-4 py-2 text-sm disabled:opacity-50">
            {exporting === "xlsx" ? "Exporting…" : "Export Excel"}
          </button>
        </div>
        {!permissions.canExportReports && <p className="mt-2 text-xs text-gray-500">Exports are not enabled for your account.</p>}
      </section>

      {res && (
        <>
          <section>
            <p className="mb-2 text-sm text-gray-500">
              {res.periods?.current?.startDate} → {res.periods?.current?.endDate} compared with{" "}
              {res.periods?.comparison?.startDate} → {res.periods?.comparison?.endDate}
              {res.metadata?.timezone ? ` · ${res.metadata.timezone}` : ""}
            </p>
            {!keys.length ? (
              <p className="rounded border bg-white p-4 text-sm text-gray-600">No data stored for this report and period.</p>
            ) : (
              <table className="w-full rounded-lg border bg-white text-sm">
                <thead className="bg-gray-50 text-left"><tr>
                  <th className="p-2">Metric</th><th className="p-2">Current</th><th className="p-2">Previous</th>
                  <th className="p-2">Change</th><th className="p-2">Change %</th>
                </tr></thead>
                <tbody>
                  {keys.map((k) => {
                    const s = summary[k] ?? {};
                    const abs = toNum(s.absoluteChange);
                    const good = abs == null || abs === 0 ? null : lowerBetter(k) ? abs < 0 : abs > 0;
                    const tone = good == null ? "" : good ? "text-green-700" : "text-red-700";
                    return (
                      <tr key={k} className="border-t">
                        <td className="p-2">{k}</td>
                        <td className="p-2">{fmt(k, s.currentValue)}</td>
                        <td className="p-2">{fmt(k, s.previousValue)}</td>
                        <td className={`p-2 ${tone}`}>{abs == null ? "—" : (abs > 0 ? "+" : "") + fmt(k, abs)}</td>
                        <td className={`p-2 ${tone}`}>
                          {s.percentageChange == null ? "—" : (toNum(s.percentageChange) > 0 ? "+" : "") + toNum(s.percentageChange).toFixed(1) + "%"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-xs text-gray-500">
              “—” means there is no previous value, or it was zero. For position, a lower number is better.
            </p>
          </section>

          {hasDates && chartMetric && (
            <section className="rounded-lg border bg-white p-4">
              <select value={chartMetric} onChange={(e) => setChartMetric(e.target.value)} className="mb-3 rounded border px-2 py-1 text-sm">
                {keys.filter((k) => k in cur[0]).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <div className="h-72">
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid vertical={false} stroke="#eee" />
                    <XAxis dataKey="day" type="number" domain={[1, chartMaxDay]} allowDecimals={false} />
                    <YAxis reversed={lowerBetter(chartMetric)} domain={["auto", "auto"]} />
                    <Tooltip labelFormatter={(d) => `Day ${d}`} />
                    <Legend />
                    <Line dataKey="current" name="Current" stroke="#4285f4" strokeWidth={2} dot={false} />
                    <Line dataKey="previous" name="Comparison" stroke="#9aa0a6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-xs text-gray-500">X-axis is the day number within each period.</p>
            </section>
          )}

          <section>
            <div className="mb-2 flex gap-1">
              {[["current", "Current period"], ["comparison", "Comparison period"]].map(([v, l]) => (
                <button key={v} onClick={() => setView(v)}
                  className={`rounded-full border px-3 py-1 text-sm ${view === v ? "bg-blue-50 text-blue-700" : "bg-white"}`}>{l}</button>
              ))}
            </div>
            {!tableRows.length ? (
              <p className="rounded border bg-white p-4 text-sm text-gray-600">No rows for this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full rounded-lg border bg-white text-sm">
                  <thead className="bg-gray-50 text-left"><tr>{Object.keys(tableRows[0]).map((k) => <th key={k} className="p-2">{k}</th>)}</tr></thead>
                  <tbody>
                    {tableRows.slice(0, 100).map((r, i) => (
                      <tr key={i} className="border-t">{Object.values(r).map((v, j) => <td key={j} className="p-2">{cell(v)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
                {tableRows.length > 100 && <p className="mt-2 text-xs text-gray-500">Showing the first 100 of {tableRows.length} rows.</p>}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}