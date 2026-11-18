import { reportDataService } from "./report-data.service.js";

const NON_ADDITIVE_METRICS = new Set(["totalUsers", "activeUsers"]);

function metricNumber(row, metric) {
  const value = row.metrics?.[metric] ?? row[metric];
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumMetric(rows, metric) {
  if (!rows.length) return null;
  let total = 0;
  for (const row of rows) {
    const value = metricNumber(row, metric);
    if (value === null) return null;
    total += value;
  }
  return Number.isFinite(total) ? total : null;
}

function weightedAverage(rows, metric, weightMetric) {
  let weightedTotal = 0;
  let weightTotal = 0;
  for (const row of rows) {
    const value = metricNumber(row, metric);
    const weight = metricNumber(row, weightMetric);
    if (value === null || weight === null) continue;
    weightedTotal += value * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedTotal / weightTotal : null;
}

function userAcquisitionSessions(row) {
  const engaged = metricNumber(row, "engagedSessions");
  const rate = metricNumber(row, "engagementRate");
  if (engaged === null || rate === null || rate <= 0) return null;
  return engaged / rate;
}

function aggregateMetric(rows, metric, source) {
  if (!rows.length || NON_ADDITIVE_METRICS.has(metric)) return null;
  if (metric === "ctr") {
    const clicks = sumMetric(rows, "clicks");
    const impressions = sumMetric(rows, "impressions");
    return clicks === null || impressions === null || impressions === 0
      ? null
      : clicks / impressions;
  }
  if (metric === "average_position") {
    if (source === "keyword_tracking") {
      const keywordIds = new Set(rows.map((row) => row.keyword_id).filter((value) => value !== undefined));
      if (keywordIds.size !== 1) return null;
      const latest = rows.reduce((newest, row) =>
        !newest || String(row.report_date) > String(newest.report_date) ? row : newest, null);
      return latest ? metricNumber(latest, metric) : null;
    }
    return weightedAverage(rows, "average_position", "impressions");
  }
  if (metric === "engagementRate") {
    if (source === "traffic_acquisition") {
      const engaged = sumMetric(rows, "engagedSessions");
      const sessions = sumMetric(rows, "sessions");
      return engaged === null || sessions === null || sessions === 0 ? null : engaged / sessions;
    }
    if (source === "user_acquisition") {
      let engagedTotal = 0;
      let sessionsTotal = 0;
      for (const row of rows) {
        const engaged = metricNumber(row, "engagedSessions");
        const sessions = userAcquisitionSessions(row);
        if (engaged === null || sessions === null) continue;
        engagedTotal += engaged;
        sessionsTotal += sessions;
      }
      return sessionsTotal > 0 ? engagedTotal / sessionsTotal : null;
    }
  }
  if (metric === "averageSessionDuration" && source === "user_acquisition") {
    let durationTotal = 0;
    let sessionsTotal = 0;
    for (const row of rows) {
      const duration = metricNumber(row, metric);
      const sessions = userAcquisitionSessions(row);
      if (duration === null || sessions === null) continue;
      durationTotal += duration * sessions;
      sessionsTotal += sessions;
    }
    return sessionsTotal > 0 ? durationTotal / sessionsTotal : null;
  }
  return sumMetric(rows, metric);
}

function compareMetric(currentValue, previousValue, metric) {
  if (
    currentValue === null ||
    previousValue === null ||
    !Number.isFinite(currentValue) ||
    !Number.isFinite(previousValue)
  ) {
    return {
      currentValue,
      previousValue,
      absoluteChange: null,
      percentageChange: null,
      trend: "unavailable",
      ...(metric === "average_position" ? { performanceTrend: "unavailable" } : {})
    };
  }
  const absoluteChange = currentValue - previousValue;
  const percentageChange = previousValue === 0
    ? null
    : (absoluteChange / previousValue) * 100;
  const trend = absoluteChange > 0 ? "up" : absoluteChange < 0 ? "down" : "unchanged";
  return {
    currentValue,
    previousValue,
    absoluteChange,
    percentageChange: Number.isFinite(percentageChange) ? percentageChange : null,
    trend,
    ...(metric === "average_position"
      ? {
          performanceTrend: absoluteChange < 0
            ? "improved"
            : absoluteChange > 0
              ? "worsened"
              : "unchanged"
        }
      : {})
  };
}

function projectRow(row, dimensions, metrics) {
  const result = {};
  for (const dimension of dimensions) {
    if (dimension === "date") result.date = row.report_date ?? null;
    else if (dimension === "dimensionValue") result.dimensionValue = row.dimensionValue ?? null;
    else if (dimension === "dimensionType") result.dimensionType = row.dimensionType ?? null;
    else if (dimension === "keywordId") result.keywordId = row.keyword_id ?? null;
    else if (dimension === "keyword") result.keyword = row.keyword ?? null;
  }
  for (const metric of metrics) {
    result[metric] = metricNumber(row, metric);
  }
  return result;
}

export function createComparisonReportService({ dataService = reportDataService } = {}) {
  return {
    async compare({
      website,
      userId,
      source,
      current,
      comparison,
      comparisonMode,
      metrics,
      dimensions,
      filters,
      sortBy,
      order,
      timeZone
    }) {
      const [currentRows, previousRows] = await Promise.all([
        dataService.getSourceRows({
          source,
          website,
          userId,
          ...current,
          filters,
          sortBy,
          order
        }),
        dataService.getSourceRows({
          source,
          website,
          userId,
          ...comparison,
          filters,
          sortBy,
          order
        })
      ]);
      const [currentSeries, comparisonSeries] = source === "traffic_acquisition" &&
        typeof dataService.getSourceSeries === "function"
        ? await Promise.all([
            dataService.getSourceSeries({
              source,
              website,
              userId,
              ...current,
              filters
            }),
            dataService.getSourceSeries({
              source,
              website,
              userId,
              ...comparison,
              filters
            })
          ])
        : [null, null];

      const summary = Object.fromEntries(metrics.map((metric) => [
        metric,
        compareMetric(
          aggregateMetric(currentRows, metric, source),
          aggregateMetric(previousRows, metric, source),
          metric
        )
      ]));
      return {
        success: true,
        filters: {
          websiteId: Number(website.website_id),
          source,
          metrics,
          dimensions,
          groupBy: dimensions,
          filters
        },
        comparisonMode,
        periods: { current, comparison },
        summary,
        data: {
          current: currentRows.map((row) => projectRow(row, dimensions, metrics)),
          comparison: previousRows.map((row) => projectRow(row, dimensions, metrics)),
          ...(currentSeries && comparisonSeries
            ? {
                currentSeries: currentSeries.map((row) => projectRow(row, ["date"], metrics)),
                comparisonSeries: comparisonSeries.map((row) => projectRow(row, ["date"], metrics))
              }
            : {})
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          timezone: timeZone
        }
      };
    }
  };
}

export const comparisonReportService = createComparisonReportService();
