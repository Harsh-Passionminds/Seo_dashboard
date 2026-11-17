import assert from "node:assert/strict";
import test from "node:test";
import { createComparisonReportService } from "../src/services/comparison-report.service.js";
import { parseComparisonQuery } from "../src/validators/report-exports.validator.js";

function parse(query) {
  return parseComparisonQuery({ source: "gsc", ...query });
}

function createComparisonService(dataForRange) {
  return createComparisonReportService({
    dataService: {
      async getSourceRows({ startDate, endDate }) {
        return dataForRange(startDate, endDate);
      }
    }
  });
}

const website = {
  website_id: 12,
  website_name: "Example",
  domain_name: "https://example.com",
  ga4_property_id: "1234",
  gsc_property_url: "sc-domain:example.com"
};

test("previous equal-length period uses inclusive dates without overlap", () => {
  const parsed = parse({
    currentStartDate: "2026-11-01",
    currentEndDate: "2026-11-17"
  });
  assert.equal(parsed.comparisonMode, "previous_period");
  assert.deepEqual(parsed.current, { startDate: "2026-11-01", endDate: "2026-11-17" });
  assert.deepEqual(parsed.comparison, { startDate: "2026-10-15", endDate: "2026-10-31" });
});

test("custom comparison uses exact supplied ranges and rejects overlap", () => {
  const parsed = parse({
    currentStartDate: "2026-11-01",
    currentEndDate: "2026-11-17",
    compareStartDate: "2026-10-15",
    compareEndDate: "2026-10-31"
  });
  assert.equal(parsed.comparisonMode, "custom");
  assert.deepEqual(parsed.comparison, { startDate: "2026-10-15", endDate: "2026-10-31" });
  assert.throws(() => parse({
    currentStartDate: "2026-11-01",
    currentEndDate: "2026-11-17",
    compareStartDate: "2026-11-17",
    compareEndDate: "2026-11-20"
  }), { code: "INVALID_COMPARISON_RANGE" });
});

test("previous week compares the same Monday-starting elapsed week", () => {
  const parsed = parse({
    currentStartDate: "2026-11-09",
    currentEndDate: "2026-11-15",
    comparisonMode: "previous_week"
  });
  assert.deepEqual(parsed.comparison, { startDate: "2026-11-02", endDate: "2026-11-08" });
  assert.throws(() => parse({
    currentStartDate: "2026-11-10",
    currentEndDate: "2026-11-16",
    comparisonMode: "previous_week"
  }), { code: "INVALID_COMPARISON_RANGE" });
});

test("previous month handles month boundaries and leap-year previous-year boundaries", () => {
  const month = parse({
    currentStartDate: "2026-03-01",
    currentEndDate: "2026-03-31",
    comparisonMode: "previous_month"
  });
  assert.deepEqual(month.comparison, { startDate: "2026-02-01", endDate: "2026-02-28" });
  const year = parse({
    currentStartDate: "2024-01-01",
    currentEndDate: "2024-02-29",
    comparisonMode: "previous_year"
  });
  assert.deepEqual(year.comparison, { startDate: "2023-01-01", endDate: "2023-02-28" });
});

test("comparison returns null percentage when previous value is zero and null for unavailable data", async () => {
  const service = createComparisonService((startDate) => startDate === "2026-11-01"
    ? [{ report_date: "2026-11-01", clicks: 4, impressions: 10, ctr: 0.4, average_position: 3 }]
    : [{ report_date: "2026-10-31", clicks: 0, impressions: 0, ctr: 0, average_position: 5 }]);
  const result = await service.compare({
    ...parse({
      currentStartDate: "2026-11-01",
      currentEndDate: "2026-11-01",
      compareStartDate: "2026-10-31",
      compareEndDate: "2026-10-31",
      metrics: "clicks,ctr"
    }),
    website,
    userId: 7,
    timeZone: "America/New_York"
  });
  assert.equal(result.summary.clicks.currentValue, 4);
  assert.equal(result.summary.clicks.previousValue, 0);
  assert.equal(result.summary.clicks.absoluteChange, 4);
  assert.equal(result.summary.clicks.percentageChange, null);
  assert.equal(result.summary.clicks.trend, "up");
  assert.equal(result.summary.ctr.currentValue, 0.4);
  assert.equal(result.summary.ctr.previousValue, null);
  assert.equal(result.summary.ctr.trend, "unavailable");
  assert.equal(result.metadata.timezone, "America/New_York");
});

test("CTR and average position are calculated from combined totals with impression weights", async () => {
  const service = createComparisonService((startDate) => startDate === "2026-11-01"
    ? [
        { report_date: "2026-11-01", clicks: 10, impressions: 100, ctr: 0.1, average_position: 2 },
        { report_date: "2026-11-02", clicks: 90, impressions: 900, ctr: 0.1, average_position: 8 }
      ]
    : [
        { report_date: "2026-10-30", clicks: 10, impressions: 100, ctr: 0.1, average_position: 10 }
      ]);
  const result = await service.compare({
    ...parse({
      currentStartDate: "2026-11-01",
      currentEndDate: "2026-11-02",
      compareStartDate: "2026-10-30",
      compareEndDate: "2026-10-30",
      metrics: "ctr,average_position"
    }),
    website,
    userId: 7,
    timeZone: "UTC"
  });
  assert.equal(result.summary.ctr.currentValue, 0.1);
  assert.equal(result.summary.average_position.currentValue, 7.4);
  assert.equal(result.summary.average_position.previousValue, 10);
  assert.equal(result.summary.average_position.performanceTrend, "improved");
});

test("engagement rate uses combined engaged sessions and sessions", async () => {
  const parsed = parseComparisonQuery({
    source: "traffic_acquisition",
    currentStartDate: "2026-11-01",
    currentEndDate: "2026-11-02",
    compareStartDate: "2026-10-30",
    compareEndDate: "2026-10-31",
    metrics: "engagementRate",
    dimensions: "dimensionValue",
    filters: JSON.stringify({ dimensionType: "source_medium" })
  });
  const service = createComparisonService((startDate) => startDate === "2026-11-01"
    ? [
        { sessions: 10, engagedSessions: 5, engagementRate: 0.5 },
        { sessions: 90, engagedSessions: 72, engagementRate: 0.8 }
      ]
    : [{ sessions: 100, engagedSessions: 60, engagementRate: 0.6 }]);
  const result = await service.compare({
    ...parsed,
    website,
    userId: 7,
    timeZone: "UTC"
  });
  assert.equal(result.summary.engagementRate.currentValue, 0.77);
  assert.equal(result.summary.engagementRate.previousValue, 0.6);
});

test("keyword ranking comparison uses latest observation, where lower position is improvement", async () => {
  const parsed = parseComparisonQuery({
    source: "keyword_tracking",
    currentStartDate: "2026-11-01",
    currentEndDate: "2026-11-03",
    compareStartDate: "2026-10-29",
    compareEndDate: "2026-10-31",
    metrics: "average_position",
    dimensions: "date,keywordId,keyword",
    filters: JSON.stringify({ keywordId: 4 })
  });
  const service = createComparisonService((startDate) => startDate === "2026-11-01"
    ? [
        { report_date: "2026-11-01", keyword_id: 4, keyword: "example", average_position: 8 },
        { report_date: "2026-11-03", keyword_id: 4, keyword: "example", average_position: 3 }
      ]
    : [
        { report_date: "2026-10-29", keyword_id: 4, keyword: "example", average_position: 9 },
        { report_date: "2026-10-31", keyword_id: 4, keyword: "example", average_position: 6 }
      ]);
  const result = await service.compare({
    ...parsed,
    website,
    userId: 7,
    timeZone: "UTC"
  });
  assert.equal(result.summary.average_position.currentValue, 3);
  assert.equal(result.summary.average_position.previousValue, 6);
  assert.equal(result.summary.average_position.performanceTrend, "improved");
  assert.equal(result.data.current[1].date, "2026-11-03");
});

test("visitor entry and landing-page sources are rejected when schema data is absent", () => {
  assert.throws(() => parseComparisonQuery({
    source: "landing_pages",
    currentStartDate: "2026-11-01",
    currentEndDate: "2026-11-02"
  }), { code: "REPORT_SOURCE_UNAVAILABLE" });
});
