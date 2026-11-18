import assert from "node:assert/strict";
import test from "node:test";
import { createReportsRepository } from "../src/repositories/reports.repository.js";
import { createKeywordReportService } from "../src/services/keyword-report.service.js";
import { parseKeywordReportQuery } from "../src/validators/reports.validator.js";

const dates = { startDate: "2026-11-01", endDate: "2026-11-17" };

test("keyword report query validates date filters, search, sorting, and bounded pagination", () => {
  assert.deepEqual(parseKeywordReportQuery(dates), {
    ...dates,
    search: "",
    sort: "keyword",
    order: "asc",
    page: 1,
    limit: 25
  });
  assert.deepEqual(parseKeywordReportQuery({
    ...dates,
    search: "  search term ",
    sort: "positionChange",
    order: "desc",
    page: "2",
    limit: "50"
  }), {
    ...dates,
    search: "search term",
    sort: "positionChange",
    order: "desc",
    page: 2,
    limit: 50
  });
  assert.throws(() => parseKeywordReportQuery({ ...dates, sort: "keyword; DROP TABLE users" }), {
    code: "INVALID_KEYWORD_SORT"
  });
  assert.throws(() => parseKeywordReportQuery({ ...dates, page: "0" }), {
    code: "INVALID_PAGINATION"
  });
});

test("keyword repository scopes list and count to the website and uses bound search and page values", async () => {
  const calls = [];
  const repository = createReportsRepository({
    async execute(sql, params) {
      calls.push({ sql, params });
      return sql.includes("COUNT(*)")
        ? [[{ total: 31 }]]
        : [[{ keyword_id: 7, website_id: 12, keyword: "example" }]];
    }
  });
  const result = await repository.getUnifiedKeywordReport({
    websiteId: 12,
    ...dates,
    search: "example%",
    sort: "positionChange",
    order: "desc",
    limit: 10,
    offset: 10
  });

  assert.equal(result.total, 31);
  assert.equal(result.rows.length, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params, [12, "example%"]);
  assert.match(calls[0].sql, /FROM tracked_keywords k\s+WHERE k\.website_id = \?/);
  assert.match(calls[1].sql, /FROM tracked_keywords k/);
  assert.match(calls[1].sql, /WHERE website_id = \? AND report_date BETWEEN \? AND \?/);
  assert.match(calls[1].sql, /ORDER BY \(\(average_position - previous_average_position\) IS NULL\) ASC/);
  assert.deepEqual(calls[1].params.slice(-4), [12, "example%", 10, 10]);
});

test("keyword report derives rank direction and preserves unavailable values", async () => {
  const service = createKeywordReportService({
    async getUnifiedKeywordReport(input) {
      assert.equal(input.offset, 25);
      return {
        total: 27,
        rows: [
          {
            keyword_id: 5,
            website_id: 12,
            keyword: "improved",
            clicks: "8",
            impressions: "100",
            ctr: "0.08",
            average_position: "3.25",
            previous_average_position: "8.5",
            last_observation_date: "2026-11-17",
            tracking_status: "updated"
          },
          {
            keyword_id: 6,
            website_id: 12,
            keyword: "missing",
            clicks: null,
            impressions: null,
            ctr: null,
            average_position: null,
            previous_average_position: "5",
            last_observation_date: "2026-10-10",
            tracking_status: "not_recently_updated"
          }
        ]
      };
    }
  });
  const result = await service.list({
    websiteId: 12,
    ...dates,
    search: "",
    sort: "keyword",
    order: "asc",
    page: 2,
    limit: 25
  });

  assert.equal(result.rows[0].positionChange, -5.25);
  assert.equal(result.rows[0].positionTrend, "improved");
  assert.equal(result.rows[0].ctr, 0.08);
  assert.equal(result.rows[1].averagePosition, null);
  assert.equal(result.rows[1].clicks, null);
  assert.equal(result.rows[1].positionChange, null);
  assert.equal(result.rows[1].positionTrend, "unavailable");
  assert.deepEqual(result.pagination, { page: 2, limit: 25, total: 27, totalPages: 2 });
});
