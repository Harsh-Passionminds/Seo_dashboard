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
    const day = dayNumber(row.date ?? row.report_date, startDate);
    if (day > 0) groups.set(day, [...(groups.get(day) ?? []), row]);
  });
  return new Map([...groups].map(([day, dayRows]) => {
    const metricValues = dayRows.map((row) => toNum(row[metric])).filter((value) => value !== null);
    let value = toNum(dayRows[0]?.[metric]);
    if (source === "user_acquisition" && dayRows.length > 1) {
      if (ADDITIVE_ACQUISITION_METRICS.has(metric) && metricValues.length === dayRows.length) {
        value = metricValues.reduce((total, current) => total + current, 0);
      } else if (metric === "engagementRate" || metric === "averageSessionDuration") {
        let engagedSessions = 0;
        let sessions = 0;
        let weightedDuration = 0;
        let incomplete = false;
        for (const row of dayRows) {
          const engaged = toNum(row.engagedSessions);
          const rate = toNum(row.engagementRate);
          const duration = toNum(row.averageSessionDuration);
          if (
            engaged === null ||
            rate === null ||
            rate <= 0 ||
            (metric === "averageSessionDuration" && duration === null)
          ) {
            incomplete = true;
            continue;
          }
          const rowSessions = engaged / rate;
          if (!Number.isFinite(rowSessions) || rowSessions <= 0) {
            incomplete = true;
            continue;
          }
          engagedSessions += engaged;
          sessions += rowSessions;
          if (duration !== null) weightedDuration += duration * rowSessions;
        }
        value = !incomplete && sessions > 0
          ? metric === "engagementRate" ? engagedSessions / sessions : weightedDuration / sessions
          : null;
      } else {
        value = null;
      }
    } else if (metricValues.length !== dayRows.length && dayRows.length > 1) {
      value = null;
    }
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
