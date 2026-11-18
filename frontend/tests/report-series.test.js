import test from "node:test";
import assert from "node:assert/strict";
import { buildReportChartSeries } from "../src/utils/report-series.js";

test("comparison series aligns sparse stored days by day within each date range", () => {
  const result = buildReportChartSeries({
    currentRows: [
      { date: "2026-01-01", clicks: 4 },
      { date: "2026-01-03", clicks: 9 }
    ],
    comparisonRows: [
      { date: "2025-12-01", clicks: 2 },
      { date: "2025-12-03", clicks: 5 }
    ],
    currentPeriod: { startDate: "2026-01-01", endDate: "2026-01-03" },
    comparisonPeriod: { startDate: "2025-12-01", endDate: "2025-12-03" },
    metric: "clicks",
    source: "gsc"
  });

  assert.deepEqual(result, {
    data: [
      { day: 1, current: 4, previous: 2 },
      { day: 3, current: 9, previous: 5 }
    ],
    maxDay: 3
  });
});

test("user acquisition sums additive same-day dimensions but leaves non-additive metrics unavailable", () => {
  const params = {
    currentRows: [
      { date: "2026-01-01", totalUsers: 4, averageSessionDuration: 20 },
      { date: "2026-01-01", totalUsers: 6, averageSessionDuration: 30 }
    ],
    comparisonRows: [],
    currentPeriod: { startDate: "2026-01-01", endDate: "2026-01-01" },
    comparisonPeriod: { startDate: "2025-12-31", endDate: "2025-12-31" },
    source: "user_acquisition"
  };

  assert.deepEqual(
    buildReportChartSeries({ ...params, metric: "totalUsers" }).data,
    [{ day: 1, current: 10, previous: null }]
  );
  assert.deepEqual(
    buildReportChartSeries({ ...params, metric: "averageSessionDuration" }).data,
    [{ day: 1, current: null, previous: null }]
  );
});

test("user acquisition rates and durations use underlying session weights", () => {
  const result = buildReportChartSeries({
    currentRows: [
      { date: "2026-01-01", engagedSessions: 8, engagementRate: 0.8, averageSessionDuration: 10 },
      { date: "2026-01-01", engagedSessions: 9, engagementRate: 0.5, averageSessionDuration: 30 }
    ],
    comparisonRows: [],
    currentPeriod: { startDate: "2026-01-01", endDate: "2026-01-01" },
    comparisonPeriod: { startDate: "2025-12-31", endDate: "2025-12-31" },
    metric: "engagementRate",
    source: "user_acquisition"
  });
  const duration = buildReportChartSeries({
    currentRows: [
      { date: "2026-01-01", engagedSessions: 8, engagementRate: 0.8, averageSessionDuration: 10 },
      { date: "2026-01-01", engagedSessions: 9, engagementRate: 0.5, averageSessionDuration: 30 }
    ],
    comparisonRows: [],
    currentPeriod: { startDate: "2026-01-01", endDate: "2026-01-01" },
    comparisonPeriod: { startDate: "2025-12-31", endDate: "2025-12-31" },
    metric: "averageSessionDuration",
    source: "user_acquisition"
  });
  assert.ok(Math.abs(result.data[0].current - (17 / 28)) < 1e-12);
  assert.ok(Math.abs(duration.data[0].current - (640 / 28)) < 1e-12);
});

test("invalid metrics and dates never produce NaN chart values", () => {
  const result = buildReportChartSeries({
    currentRows: [{ date: "2026-01-01", clicks: "not-a-number" }],
    comparisonRows: [],
    currentPeriod: { startDate: "2026-01-01", endDate: "2026-01-01" },
    comparisonPeriod: { startDate: "2025-12-31", endDate: "2025-12-31" },
    metric: "clicks",
    source: "gsc"
  });

  assert.deepEqual(result.data, [{ day: 1, current: null, previous: null }]);
  assert.equal(Number.isFinite(result.maxDay), true);
});
