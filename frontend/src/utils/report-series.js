import { toNum } from "./format.js";

const ADDITIVE_ACQUISITION_METRICS = new Set([
  "totalUsers", "newUsers", "activeUsers", "engagedSessions", "conversions", "totalRevenue"
]);
const DAY_MS = 86400000;

function dayNumber(date, startDate) {
  if (!date || !startDate) return null;
  const rowTime = Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`);
  const startTime = Date.parse(`${startDate}T00:00:00Z`);
  return Number.isFinite(rowTime) && Number.isFinite(startTime)
    ? Math.floor((rowTime - startTime) / DAY_MS) + 1
    : null;
}

function dailyMetricMap(rows, startDate, metric, source) {
  const groups = new Map();
  rows.forEach((row) => {
    const day = dayNumber(row.date, startDate);
    if (day > 0) groups.set(day, [...(groups.get(day) ?? []), row]);
  });
  return new Map([...groups].map(([day, dayRows]) => {
    const metricValues = dayRows.map((row) => toNum(row[metric])).filter((value) => value !== null);
    const value = source === "user_acquisition" && dayRows.length > 1
      ? ADDITIVE_ACQUISITION_METRICS.has(metric) && metricValues.length
        ? metricValues.reduce((total, current) => total + current, 0)
        : null
      : toNum(dayRows[0]?.[metric]);
    return [day, value];
  }));
}

export function buildReportChartSeries({
  currentRows,
  comparisonRows,
  currentPeriod,
  comparisonPeriod,
  metric,
  source
}) {
  const currentByDay = dailyMetricMap(currentRows, currentPeriod?.startDate, metric, source);
  const comparisonByDay = dailyMetricMap(comparisonRows, comparisonPeriod?.startDate, metric, source);
  const data = [...new Set([...currentByDay.keys(), ...comparisonByDay.keys()])]
    .sort((a, b) => a - b)
    .map((day) => ({
      day,
      current: currentByDay.get(day) ?? null,
      previous: comparisonByDay.get(day) ?? null
    }));
  const currentLength = dayNumber(currentPeriod?.endDate, currentPeriod?.startDate) ?? 1;
  const comparisonLength = dayNumber(comparisonPeriod?.endDate, comparisonPeriod?.startDate) ?? 1;
  return { data, maxDay: Math.max(currentLength, comparisonLength, 1) };
}
