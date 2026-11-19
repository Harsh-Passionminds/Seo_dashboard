import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { getGsc, getWebsites } from "../../services/endpoints";
import MonthlyComparison from "./MonthlyComparison";
import { useWebsite, useDateRange } from "../../hooks/useAppContext";
import { useSession } from "../../hooks/useSession";
import { toNum, downloadCsv } from "../../utils/format";
import { exportExcelReport } from "../../utils/excel-chart-export";

const METRICS = {
  clicks:           { label: "Total clicks",      color: "#4285f4", bg: "bg-[#4285f4]" },
  impressions:      { label: "Total impressions", color: "#5e35b1", bg: "bg-[#5e35b1]" },
  ctr:              { label: "Average CTR",       color: "#0b8043", bg: "bg-[#0b8043]" },
  average_position: { label: "Average position",  color: "#e8710a", bg: "bg-[#e8710a]" },
};

const n = (v) => toNum(v);

export default function GscPage() {
  const { websiteId } = useWebsite();
  const { range } = useDateRange();
  const { permissions } = useSession();
  const [active, setActive] = useState(["clicks", "impressions"]);
  const [exportingXlsx, setExportingXlsx] = useState(false);

  const sites = useQuery({ queryKey: ["websites"], queryFn: getWebsites, enabled: !!websiteId });
  const websiteName = sites.data?.websites?.find((w) => Number(w.website_id) === Number(websiteId))?.website_name || "Website";

  const onExportXlsx = async () => {
    setExportingXlsx(true);
    try {
      await exportExcelReport({
        websiteId,
        websiteName,
        source: "gsc",
        startDate: range.startDate,
        endDate: range.endDate,
        reportResult: rows
      });
    } catch (e) {
      alert(e.message);
    } finally {
      setExportingXlsx(false);
    }
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["gsc", websiteId, range],
    queryFn: () => getGsc(websiteId, range),
    enabled: !!websiteId,
  });

  const rows = (data?.rows ?? []).map((r) => ({
    date: r.report_date,
    clicks: n(r.clicks),
    impressions: n(r.impressions),
    ctr: n(r.ctr),
    average_position: n(r.average_position),
  }));

  // Combined CTR = sum clicks / sum impressions (never average daily CTRs)
  const tc = rows.reduce((s, r) => s + (r.clicks ?? 0), 0);
  const ti = rows.reduce((s, r) => s + (r.impressions ?? 0), 0);
  const totals = {
    clicks: tc,
    impressions: ti,
    ctr: ti ? tc / ti : null,
    average_position: rows.length ? rows[rows.length - 1].average_position : null, // see note below
  };

  const toggle = (k) =>
    setActive((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]));

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p className="text-red-600">{error.message}</p>;
  if (!rows.length) return <p>No data stored for this period.</p>;

  return (
    <div>
      <div className="grid grid-cols-4 gap-3 mb-4">
        {Object.entries(METRICS).map(([k, m]) => {
          const on = active.includes(k);
          return (
            <button key={k} onClick={() => toggle(k)}
              className={`rounded-lg p-4 text-left text-white ${on ? m.bg : "bg-gray-100 !text-gray-600"}`}>
              <div className="text-sm">{m.label}</div>
              <div className="text-2xl">
                {totals[k] == null ? "No data"
                  : k === "ctr" ? (totals[k] * 100).toFixed(1) + "%"
                  : k === "average_position" ? totals[k].toFixed(1)
                  : totals[k].toLocaleString()}
              </div>
            </button>
          );
        })}
      </div>

      <div className="h-80 bg-white rounded-lg border p-3">
        <ResponsiveContainer>
          <LineChart data={rows}>
            <CartesianGrid vertical={false} stroke="#eee" />
            <XAxis dataKey="date" />
            <YAxis yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" reversed={active.includes("average_position")} />
            <Tooltip />
            {active.map((k) => (
              <Line key={k} dataKey={k} stroke={METRICS[k].color} dot={false} strokeWidth={2}
                yAxisId={k === "ctr" || k === "average_position" ? "right" : "left"} />
            ))}
          </LineChart>
                </ResponsiveContainer>
      </div>

      {permissions.canExportReports && (
        <div className="my-3 flex justify-end gap-2">
          <button onClick={() => downloadCsv("gsc-performance.csv", rows)} className="rounded border px-3 py-1 text-sm">
            Export CSV
          </button>
          <button onClick={onExportXlsx} disabled={exportingXlsx} className="rounded border px-3 py-1 text-sm disabled:opacity-50">
            {exportingXlsx ? "Exporting…" : "Export Excel"}
          </button>
        </div>
      )}

      <MonthlyComparison />
    </div>
  );
}