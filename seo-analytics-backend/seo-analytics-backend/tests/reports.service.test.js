import assert from "node:assert/strict";
import test from "node:test";
import { createReportsService } from "../src/services/reports.service.js";
import {
  parseGa4ReportQuery,
  parseKeywordId,
  parseReportDateRange
} from "../src/validators/reports.validator.js";
import {
  createRequireWebsiteReportAccess,
  createRequireWebsiteReportOwner
} from "../src/middleware/reports-access.js";
import { createReportsRepository } from "../src/repositories/reports.repository.js";

test("report date validation preserves inclusive bounded date ranges", () => {
  assert.deepEqual(
    parseReportDateRange({ startDate: "2026-11-01", endDate: "2026-11-07" }),
    { startDate: "2026-11-01", endDate: "2026-11-07", days: 7 }
  );
  assert.throws(
    () => parseReportDateRange({ startDate: "2026-02-30", endDate: "2026-03-01" }),
    { code: "INVALID_DATE" }
  );
  assert.throws(
    () => parseReportDateRange({ startDate: "2026-11-08", endDate: "2026-11-07" }),
    { code: "INVALID_DATE_RANGE" }
  );
  assert.throws(
    () => parseReportDateRange({ startDate: "2025-01-01", endDate: "2026-11-07" }),
    { code: "DATE_RANGE_TOO_LARGE" }
  );
});

test("GA4 report validation supports only stored report types and dimensions", () => {
  assert.deepEqual(parseGa4ReportQuery({}), {
    reportType: "summary",
    dimensionType: "default_channel_group"
  });
  assert.deepEqual(parseGa4ReportQuery({ reportType: "traffic_acquisition" }), {
    reportType: "traffic_acquisition",
    dimensionType: "default_channel_group"
  });
  assert.throws(
    () => parseGa4ReportQuery({ reportType: "unknown" }),
    { code: "INVALID_REPORT_TYPE" }
  );
  assert.throws(
    () => parseGa4ReportQuery({ reportType: "user_acquisition", dimensionType: "unknown" }),
    { code: "INVALID_DIMENSION_TYPE" }
  );
});

test("keyword report identifiers reject invalid and unsafe integers", () => {
  assert.equal(parseKeywordId("18"), 18);
  assert.throws(() => parseKeywordId("0"), { code: "INVALID_KEYWORD_ID" });
  assert.throws(() => parseKeywordId("1.5"), { code: "INVALID_KEYWORD_ID" });
  assert.throws(() => parseKeywordId(String(Number.MAX_SAFE_INTEGER + 1)), {
    code: "INVALID_KEYWORD_ID"
  });
});

test("overview combines stored report sources without generating absent rows", async () => {
  const calls = [];
  const rows = {
    gsc: [{ report_date: "2026-11-01", clicks: 4 }],
    ga4: [{ report_date: "2026-11-01", organic_sessions: 3 }],
    userAcquisition: [],
    defaultChannelGroup: { rows: [], total: { sessions: 0, engagedSessions: 0 } },
    sourceMedium: { rows: [], total: { sessions: 0, engagedSessions: 0 } },
    sync: { checkpoints: [], recentJobs: [] }
  };
  const service = createReportsService({
    repository: {
      async getSyncMetadata(websiteId) {
        calls.push(["sync", websiteId]);
        return rows.sync;
      }
    },
    gsc: {
      async getDailyPerformance(input) {
        calls.push(["gsc", input]);
        return rows.gsc;
      }
    },
    ga4: {
      async getDailySummary(input) {
        calls.push(["summary", input]);
        return rows.ga4;
      },
      async getStoredUserAcquisition(input) {
        calls.push(["user_acquisition", input]);
        return rows.userAcquisition;
      }
    },
    acquisition: {
      async getTrafficAcquisition(input) {
        calls.push([input.dimensionType, input]);
        return input.dimensionType === "default_channel_group"
          ? rows.defaultChannelGroup
          : rows.sourceMedium;
      }
    }
  });

  const result = await service.getOverview({
    website: {
      website_id: 14,
      website_name: "Example",
      domain_name: "https://example.com",
      ga4_property_id: "1234",
      gsc_property_url: "sc-domain:example.com"
    },
    userId: 7,
    startDate: "2026-11-01",
    endDate: "2026-11-07"
  });

  assert.equal(result.website.websiteId, 14);
  assert.deepEqual(result.data.googleSearchConsole, rows.gsc);
  assert.deepEqual(result.data.googleAnalytics, rows.ga4);
  assert.deepEqual(result.data.trafficAcquisition.defaultChannelGroup, rows.defaultChannelGroup);
  assert.deepEqual(result.data.trafficAcquisition.sourceMedium, rows.sourceMedium);
  assert.deepEqual(result.data.userAcquisition, []);
  assert.deepEqual(result.sync, rows.sync);
  assert.equal(calls.length, 6);
});

test("report access allows website owners and explicitly granted viewers only within their organization", async () => {
  const calls = [];
  const website = { website_id: 14, owner_user_id: 9 };
  const middleware = createRequireWebsiteReportAccess({
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[website]];
    }
  });
  const req = {
    params: { websiteId: "14" },
    user: { user_id: 7 },
    organization: { organization_id: 3 },
    membership: { role: "analyst" }
  };
  let nextError;
  await middleware(req, {}, (error) => {
    nextError = error;
  });

  assert.equal(nextError, undefined);
  assert.equal(req.website, website);
  assert.deepEqual(calls[0].params, [7, 14, 3]);
  assert.match(calls[0].sql, /p\.can_view = TRUE/);
  assert.match(calls[0].sql, /w\.organization_id = \?/);
});

test("report access hides websites without a matching owner or view grant", async () => {
  const middleware = createRequireWebsiteReportAccess({
    async execute() {
      return [[]];
    }
  });
  let nextError;
  await middleware({
    params: { websiteId: "14" },
    user: { user_id: 7 },
    organization: { organization_id: 3 },
    membership: { role: "viewer" }
  }, {}, (error) => {
    nextError = error;
  });

  assert.equal(nextError.status, 404);
  assert.equal(nextError.code, "WEBSITE_NOT_FOUND");
});

test("Admin report write access remains scoped to the active organization", async () => {
  let received;
  const middleware = createRequireWebsiteReportOwner({
    async execute(sql, params) {
      received = { sql, params };
      return [[{ website_id: 14, owner_user_id: 7 }]];
    }
  });
  let nextError;
  await middleware({
    params: { websiteId: "14" },
    user: { user_id: 7 },
    organization: { organization_id: 3 },
    membership: { role: "admin" }
  }, {}, (error) => {
    nextError = error;
  });

  assert.equal(nextError, undefined);
  assert.deepEqual(received.params, [14, 3]);
  assert.match(received.sql, /w\.organization_id = \?/);
  assert.match(received.sql, /AND TRUE/);
});

test("report repository uses parameterized website and date filters", async () => {
  const calls = [];
  const repository = createReportsRepository({
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[{ report_date: "2026-11-01" }]];
    }
  });
  const result = await repository.getGscDaily(14, "2026-11-01", "2026-11-07");

  assert.deepEqual(result, [{ report_date: "2026-11-01" }]);
  assert.deepEqual(calls[0].params, [14, "2026-11-01", "2026-11-07"]);
  assert.match(calls[0].sql, /FROM google_search_console_data/);
  assert.match(calls[0].sql, /website_id = \? AND report_date BETWEEN \? AND \?/);
});
