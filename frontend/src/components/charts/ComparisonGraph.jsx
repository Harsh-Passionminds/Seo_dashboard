import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { buildReportChartSeries } from "../../utils/report-series";

function PeriodChart({ title, data, metric, color, maxDay }) {
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
              <YAxis reversed={metric.toLowerCase().includes("position")} />
              <Tooltip labelFormatter={(day) => `Day ${day}`} />
              <Line dataKey="value" stroke={color} strokeWidth={2} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function ComparisonGraph({
  currentRows = [],
  comparisonRows = [],
  currentPeriod,
  comparisonPeriod,
  source,
  metrics = [],
  metric,
  onMetricChange,
  layout = "overlay",
  currentLabel = "Current period",
  comparisonLabel = "Comparison period",
  emptyText = "No daily data is available for this comparison."
}) {
  const series = buildReportChartSeries({
    currentRows,
    comparisonRows,
    currentPeriod,
    comparisonPeriod,
    metric,
    source
  });
  const hasData = series.data.some((row) => row.current !== null || row.previous !== null);
  const convert = (value) => source === "gsc" && metric === "ctr" && value !== null
    ? value * 100
    : value;
  const currentData = series.data
    .map((row) => ({ day: row.day, value: convert(row.current) }))
    .filter((row) => row.value !== null);
  const comparisonData = series.data
    .map((row) => ({ day: row.day, value: convert(row.previous) }))
    .filter((row) => row.value !== null);

  if (!metrics.length || !metric) return null;

  return (
    <section className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-medium">Comparison graph</div>
        <select value={metric} onChange={(event) => onMetricChange(event.target.value)}
          className="rounded border px-2 py-1 text-sm">
          {metrics.map((item) => (
            <option key={item.key} value={item.key}>{item.label}</option>
          ))}
        </select>
      </div>
      {!hasData ? (
        <div className="flex h-72 items-center justify-center text-sm text-gray-500">{emptyText}</div>
      ) : layout === "periods" ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <PeriodChart title={`${currentLabel} · ${currentPeriod?.startDate ?? "—"} → ${currentPeriod?.endDate ?? "—"}`}
              data={currentData} metric={metric} color="#4285f4" maxDay={series.maxDay} />
            <PeriodChart title={`${comparisonLabel} · ${comparisonPeriod?.startDate ?? "—"} → ${comparisonPeriod?.endDate ?? "—"}`}
              data={comparisonData} metric={metric} color="#4285f4" maxDay={series.maxDay} />
          </div>
          <p className="mt-2 text-xs text-gray-500">Both charts use the same scale; the X-axis is the day within each period.</p>
        </>
      ) : (
        <>
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={series.data}>
                <CartesianGrid vertical={false} stroke="#eee" />
                <XAxis dataKey="day" type="number" domain={[1, series.maxDay]} allowDecimals={false} />
                <YAxis reversed={metric.toLowerCase().includes("position")} domain={["auto", "auto"]} />
                <Tooltip labelFormatter={(day) => `Day ${day}`} />
                <Legend />
                <Line dataKey="current" name={currentLabel} stroke="#4285f4" strokeWidth={2} dot={false} connectNulls={false}
                  activeDot={{ r: 4 }} />
                <Line dataKey="previous" name={comparisonLabel} stroke="#9aa0a6" strokeWidth={2} dot={false} connectNulls={false}
                  activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {currentPeriod?.startDate ?? "—"} → {currentPeriod?.endDate ?? "—"} compared with{" "}
            {comparisonPeriod?.startDate ?? "—"} → {comparisonPeriod?.endDate ?? "—"}; X-axis is the day within each period.
          </p>
        </>
      )}
    </section>
  );
}
