import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, subMonths, subDays, parseISO, differenceInCalendarDays } from "date-fns";
import { getGsc } from "../../services/endpoints";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useWebsite } from "../../hooks/useAppContext";
import QueryState from "../../components/ui/QueryState";
import { toNum, fmtInt, fmtPct, fmtPos, change } from "../../utils/format";

const iso = (d) => format(d, "yyyy-MM-dd");
const monthLabel = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return format(new Date(y, m - 1, 1), "MMMM yyyy");
};

// Full month, but never later than yesterday (today's data isn't final)
function monthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const start = startOfMonth(new Date(y, m - 1, 1));
  const yesterday = subDays(new Date(), 1);
  const end = endOfMonth(start) > yesterday ? yesterday : endOfMonth(start);
  return { startDate: iso(start), endDate: iso(end), valid: start <= end, msg: "has no completed days yet. Pick another month." };
}

function customRange(c) {
  const bad = (msg) => ({ ...c, valid: false, msg });
  if (!c.startDate || !c.endDate) return bad("pick both dates.");
  const days = differenceInCalendarDays(parseISO(c.endDate), parseISO(c.startDate)) + 1;
  if (days < 1) return bad("the start date must be on or before the end date.");
  if (days > 550) return bad("the maximum range is 550 days.");
  if (c.endDate > iso(subDays(new Date(), 1))) return bad("the end date can't be after yesterday.");
  return { ...c, valid: true };
}

function summarize(rows) {
  const clicks = rows.reduce((s, r) => s + (toNum(r.clicks) ?? 0), 0);
  const impressions = rows.reduce((s, r) => s + (toNum(r.impressions) ?? 0), 0);
  // impressions-weighted position (not a plain average of daily averages)
  const posRows = rows.filter((r) => toNum(r.average_position) != null && toNum(r.impressions));
  const posWeight = posRows.reduce((s, r) => s + toNum(r.impressions), 0);
  const position = posWeight
    ? posRows.reduce((s, r) => s + toNum(r.average_position) * toNum(r.impressions), 0) / posWeight
    : null;
  return {
    days: rows.length,
    clicks: rows.length ? clicks : null,
    impressions: rows.length ? impressions : null,
    ctr: impressions ? clicks / impressions : null,
    position,
  };
}

const ROWS = [
  { key: "clicks", label: "Total clicks", fmt: fmtInt },
  { key: "impressions", label: "Total impressions", fmt: fmtInt },
  { key: "ctr", label: "Average CTR", fmt: fmtPct, pp: true },
  { key: "position", label: "Average position (impression-weighted)", fmt: fmtPos, lowerBetter: true },
];

const METRIC_OPTIONS = {
  clicks: { label: "Clicks", color: "#4285f4" },
  impressions: { label: "Impressions", color: "#5e35b1" },
  ctr: { label: "CTR (%)", color: "#0b8043" },
  average_position: { label: "Average position", color: "#e8710a" },
};

// one point per stored day only; missing days are not filled in
function toSeries(rows, key, startDate) {
  return rows
    .map((r) => {
      let v = toNum(r[key]);
      if (v != null && key === "ctr") v = v * 100;
      const day = differenceInCalendarDays(parseISO(String(r.report_date).slice(0, 10)), parseISO(startDate)) + 1;
      return { day, value: v };
    })
    .filter((p) => p.value != null);
}

function MonthChart({ title, data, domain, color, reversed, maxDay }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 text-sm font-medium">{title}</div>
      {!data.length ? (
        <div className="flex h-56 items-center justify-center text-sm text-gray-500">No data stored for this period</div>
      ) : (
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={data}>
              <CartesianGrid vertical={false} stroke="#eee" />
              <XAxis dataKey="day" type="number" domain={[1, maxDay]} allowDataOverflow allowDecimals={false} />
              <YAxis reversed={reversed} domain={domain} />
              <Tooltip labelFormatter={(d) => `Day ${d}`} />
              <Line dataKey="value" stroke={color} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function PeriodPicker({ mode, setMode, month, setMonth, custom, setCustom }) {
  const maxDate = iso(subDays(new Date(), 1));
  return (
    <div className="flex items-center gap-2">
      <select value={mode} onChange={(e) => setMode(e.target.value)} className="rounded border px-2 py-1">
        <option value="month">Month</option>
        <option value="custom">Custom dates</option>
      </select>
      {mode === "month" ? (
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded border px-2 py-1" />
      ) : (
        <>
          <input type="date" max={maxDate} value={custom.startDate}
            onChange={(e) => setCustom({ ...custom, startDate: e.target.value })} className="rounded border px-2 py-1" />
          <span>–</span>
          <input type="date" max={maxDate} value={custom.endDate}
            onChange={(e) => setCustom({ ...custom, endDate: e.target.value })} className="rounded border px-2 py-1" />
        </>
      )}
    </div>
  );
}

export default function MonthlyComparison() {
  const { websiteId } = useWebsite();
  const now = new Date();
  const [monthA, setMonthA] = useState(format(now, "yyyy-MM"));
  const [monthB, setMonthB] = useState(format(subMonths(now, 1), "yyyy-MM"));
  const [metric, setMetric] = useState("clicks");
  const [modeA, setModeA] = useState("month");
  const [modeB, setModeB] = useState("month");
  const yday = subDays(now, 1);
  const [customA, setCustomA] = useState({ startDate: iso(subDays(yday, 13)), endDate: iso(yday) });
  const [customB, setCustomB] = useState({ startDate: iso(subDays(yday, 27)), endDate: iso(subDays(yday, 14)) });
  const ra = modeA === "month" ? monthRange(monthA) : customRange(customA);
  const rb = modeB === "month" ? monthRange(monthB) : customRange(customB);
  const titleA = modeA === "month" ? monthLabel(monthA) : `${customA.startDate} → ${customA.endDate}`;
  const titleB = modeB === "month" ? monthLabel(monthB) : `${customB.startDate} → ${customB.endDate}`;

  const qa = useQuery({
    queryKey: ["gsc-month", websiteId, ra.startDate, ra.endDate],
    queryFn: () => getGsc(websiteId, ra),
    enabled: !!websiteId && ra.valid,
  });
  const qb = useQuery({
    queryKey: ["gsc-month", websiteId, rb.startDate, rb.endDate],
    queryFn: () => getGsc(websiteId, rb),
    enabled: !!websiteId && rb.valid,
  });

  const a = summarize(qa.data?.rows ?? []);
  const b = summarize(qb.data?.rows ?? []);

  const sa = toSeries(qa.data?.rows ?? [], metric, ra.startDate);
  const sb = toSeries(qb.data?.rows ?? [], metric, rb.startDate);
  const span = (r) => (r.valid ? differenceInCalendarDays(parseISO(r.endDate), parseISO(r.startDate)) + 1 : 1);
  const maxDay = Math.max(span(ra), span(rb));
  const all = [...sa, ...sb].map((p) => p.value);
  const hi = all.length ? Math.ceil(Math.max(...all)) : 0;
  const lo = all.length ? Math.floor(Math.min(...all)) : 0;
  const domain = metric === "average_position" ? [lo, hi] : [0, hi];
  const loading = qa.isLoading || qb.isLoading;
  const error = qa.error || qb.error;
  const bothEmpty = !loading && !error && !a.days && !b.days;

  return (
    <section className="mt-6 rounded-lg border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Monthly comparison</h2>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <PeriodPicker mode={modeA} setMode={setModeA} month={monthA} setMonth={setMonthA} custom={customA} setCustom={setCustomA} />
          <span>vs</span>
          <PeriodPicker mode={modeB} setMode={setModeB} month={monthB} setMonth={setMonthB} custom={customB} setCustom={setCustomB} />
        </div>
      </div>

      {(!ra.valid || !rb.valid) && (
        <p className="text-sm text-gray-600">
          {!ra.valid ? `${titleA}: ${ra.msg}` : `${titleB}: ${rb.msg}`}
        </p>
      )}

      {ra.valid && rb.valid && (
        <QueryState query={{ isLoading: loading, error, refetch: () => { qa.refetch(); qb.refetch(); } }} isEmpty={bothEmpty}>
          <div className="mb-4">
            <select value={metric} onChange={(e) => setMetric(e.target.value)} className="mb-3 rounded border px-2 py-1 text-sm">
              {Object.entries(METRIC_OPTIONS).map(([k, m]) => (
                <option key={k} value={k}>{m.label}</option>
              ))}
            </select>
            <div className="grid gap-4 md:grid-cols-2">
              <MonthChart title={titleA} maxDay={maxDay} data={sa} domain={domain}
                color={METRIC_OPTIONS[metric].color} reversed={metric === "average_position"} />
              <MonthChart title={titleB} maxDay={maxDay} data={sb} domain={domain}
                color={METRIC_OPTIONS[metric].color} reversed={metric === "average_position"} />
            </div>
            <p className="mt-2 text-xs text-gray-500">Both charts use the same scale. The X-axis is the day number within each period.</p>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="p-2">Metric</th>
                <th className="p-2">{titleA}<div className="text-xs font-normal text-gray-500">{a.days} days stored</div></th>
                <th className="p-2">{titleB}<div className="text-xs font-normal text-gray-500">{b.days} days stored</div></th>
                <th className="p-2">Change</th>
                <th className="p-2">Change %</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => {
                const ch = change(a[r.key], b[r.key]);
                const good = ch.abs == null || ch.abs === 0 ? null : r.lowerBetter ? ch.abs < 0 : ch.abs > 0;
                const tone = good == null ? "" : good ? "text-green-700" : "text-red-700";
                return (
                  <tr key={r.key} className="border-t">
                    <td className="p-2">{r.label}</td>
                    <td className="p-2">{r.fmt(a[r.key])}</td>
                    <td className="p-2">{r.fmt(b[r.key])}</td>
                    <td className={`p-2 ${tone}`}>
                      {ch.abs == null ? "—"
                        : (ch.abs > 0 ? "+" : "") + (r.pp ? (ch.abs * 100).toFixed(2) + " pp"
                          : r.key === "position" ? ch.abs.toFixed(1) : Math.round(ch.abs).toLocaleString())}
                    </td>
                    <td className={`p-2 ${tone}`}>{ch.pct == null ? "—" : (ch.pct * 100).toFixed(1) + "%"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {a.days !== b.days && (
            <p className="mt-3 text-xs text-gray-500">
              The two periods cover a different number of days ({a.days} vs {b.days}), so totals are not like-for-like.
              CTR and position are better to compare in that case.
            </p>
          )}
          <p className="mt-1 text-xs text-gray-500">Lower average position is better. “—” means there is no data or the previous value is zero.</p>
        </QueryState>
      )}
    </section>
  );
} 