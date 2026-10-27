import test from "node:test";
import assert from "node:assert/strict";
import { createGa4Service } from "../src/services/ga4.service.js";

const website = {
  website_id: 12,
  owner_user_id: 7,
  ga4_property_id: "123456789"
};

function makePool({ failExecute = false, storedRows = [], affectedRows = 1 } = {}) {
  const writes = [];
  const events = [];
  const queries = [];
  const connection = {
    async beginTransaction() {
      events.push("begin");
    },
    async execute(sql, params) {
      events.push("execute");
      writes.push({ sql, params });
      if (failExecute) throw new Error("database write failed");
      return [{ affectedRows }];
    },
    async commit() {
      events.push("commit");
    },
    async rollback() {
      events.push("rollback");
    },
    release() {
      events.push("release");
    }
  };
  return {
    writes,
    events,
    queries,
    connection,
    async getConnection() {
      return connection;
    },
    async execute(sql, params) {
      queries.push({ sql, params });
      return [storedRows, [sql, params]];
    }
  };
}

function makeRows(dimensionName, start, end) {
  const result = [];
  for (let index = start; index < end; index += 1) {
    result.push({
      dimensionValues: [
        { value: `2026100${index + 1}` },
        { value: `${dimensionName}-value-${index + 1}` }
      ],
      metricValues: Array.from(
        { length: dimensionName.startsWith("firstUser") ? 8 : 9 },
        (_, metricIndex) => ({
        value: String(metricIndex + index + 1)
        })
      )
    });
  }
  return result;
}

function makeTrafficRows(dimensionName, start, end) {
  const result = [];
  for (let index = start; index < end; index += 1) {
    result.push({
      dimensionValues: [
        { value: `2026100${index + 1}` },
        { value: `${dimensionName}-value-${index + 1}` }
      ],
      metricValues: [
        { value: String(10 + index) },
        { value: String(5 + index) }
      ]
    });
  }
  return result;
}

test("traffic sync fetches and paginates both report dimensions into the consolidated table", async () => {
  const dbPool = makePool();
  const requests = [];
  const service = createGa4Service({
    dbPool,
    pageSize: 2,
    authorize: async (userId) => ({ userId }),
    createAnalyticsData: () => ({
      properties: {
        runReport: async (request) => {
          requests.push(request);
          const dimensionName = request.requestBody.dimensions[1].name;
          const offset = Number(request.requestBody.offset);
          const rows = makeTrafficRows(dimensionName, offset, Math.min(offset + 2, 3));
          return { data: { rowCount: "3", rows } };
        }
      }
    })
  });

  const result = await service.syncGa4TrafficAcquisition({
    userId: 7,
    website,
    startDate: "2026-10-01",
    endDate: "2026-10-03"
  });

  assert.equal(result.rowsFetched, 6);
  assert.equal(result.rowsInserted, 6);
  assert.equal(result.rowsUpdated, 0);
  assert.equal(requests.length, 4);
  assert.deepEqual(
    requests.map((request) => request.requestBody.dimensions[1].name),
    [
      "sessionDefaultChannelGroup",
      "sessionDefaultChannelGroup",
      "sessionSourceMedium",
      "sessionSourceMedium"
    ]
  );
  assert.ok(requests.every((request) => request.property === "properties/123456789"));
  assert.deepEqual(requests[0].requestBody.orderBys, [
    { dimension: { dimensionName: "date" } },
    { dimension: { dimensionName: "sessionDefaultChannelGroup" } }
  ]);
  assert.equal(dbPool.writes.length, 6);
  assert.ok(dbPool.writes.every(({ sql }) => sql.includes("INSERT INTO ga4_traffic_acquisition_data")));
  assert.deepEqual(dbPool.writes[0].params, [
    7,
    12,
    "2026-10-01",
    "default_channel_group",
    "sessionDefaultChannelGroup-value-1",
    "sessionDefaultChannelGroup-value-1",
    null,
    10,
    5
  ]);
  assert.deepEqual(dbPool.events.slice(-2), ["commit", "release"]);
});

test("acquisition sync rejects invalid reports and websites before authorizing Google", async () => {
  let authorizeCalls = 0;
  const service = createGa4Service({
    authorize: async () => {
      authorizeCalls += 1;
      return {};
    }
  });
  const common = {
    userId: 7,
    website,
    startDate: "2026-10-01",
    endDate: "2026-10-03",
    reportType: "user_acquisition"
  };

  await assert.rejects(
    service.syncGa4Acquisition({ ...common, reportType: "invalid" }),
    { code: "INVALID_REPORT_TYPE" }
  );
  await assert.rejects(
    service.syncGa4Acquisition({ ...common, reportType: "toString" }),
    { code: "INVALID_REPORT_TYPE" }
  );
  await assert.rejects(
    service.syncGa4Acquisition({ ...common, dimensionType: "invalid" }),
    { code: "INVALID_DIMENSION_TYPE" }
  );
  await assert.rejects(
    service.syncGa4Acquisition({ ...common, website: { ...website, owner_user_id: 8 } }),
    { code: "WEBSITE_FORBIDDEN" }
  );
  await assert.rejects(
    service.syncGa4Acquisition({ ...common, website: { ...website, ga4_property_id: "" } }),
    { code: "GA4_PROPERTY_MISSING" }
  );
  assert.equal(authorizeCalls, 0);
});

test("upsert results distinguish inserted rows from updated rows", async () => {
  const dbPool = makePool({ affectedRows: 2 });
  const service = createGa4Service({
    dbPool,
    authorize: async () => ({}),
    createAnalyticsData: () => ({
      properties: {
        runReport: async (request) => ({
          data: {
            rowCount: 1,
            rows: makeRows(request.requestBody.dimensions[1].name, 0, 1)
          }
        })
      }
    })
  });

  const result = await service.syncGa4Acquisition({
    userId: 7,
    website,
    startDate: "2026-10-01",
    endDate: "2026-10-01",
    reportType: "user_acquisition"
  });

  assert.deepEqual(result, { rowsFetched: 2, rowsInserted: 0, rowsUpdated: 2 });
  assert.ok(dbPool.writes.every(({ sql }) => sql.includes("ON DUPLICATE KEY UPDATE")));
});

test("traffic sync rolls back and releases its connection when a write fails", async () => {
  const dbPool = makePool({ failExecute: true });
  const service = createGa4Service({
    dbPool,
    pageSize: 2,
    authorize: async () => ({}),
    createAnalyticsData: () => ({
      properties: {
        runReport: async (request) => ({
          data: {
            rowCount: 1,
            rows: makeTrafficRows(request.requestBody.dimensions[1].name, 0, 1)
          }
        })
      }
    })
  });

  await assert.rejects(
    service.syncGa4TrafficAcquisition({
      userId: 7,
      website,
      startDate: "2026-10-01",
      endDate: "2026-10-01"
    }),
    /database write failed/
  );
  assert.deepEqual(dbPool.events, ["begin", "execute", "rollback", "release"]);
});

test("GA4 API quota failures are returned as explicit errors", async () => {
  const service = createGa4Service({
    authorize: async () => ({}),
    createAnalyticsData: () => ({
      properties: {
        runReport: async () => {
          const error = new Error("quota exceeded");
          error.response = { status: 429 };
          throw error;
        }
      }
    })
  });

  await assert.rejects(
    service.syncGa4TrafficAcquisition({
      userId: 7,
      website,
      startDate: "2026-10-01",
      endDate: "2026-10-01"
    }),
    { status: 429, code: "GA4_QUOTA_EXCEEDED" }
  );
});

test("summary synchronization remains available and stores daily event totals", async () => {
  const dbPool = makePool();
  const service = createGa4Service({
    dbPool,
    authorize: async () => ({}),
    createAnalyticsData: () => ({
      properties: {
        runReport: async ({ requestBody }) => {
          if (requestBody.dimensions.length === 1) {
            return {
              data: {
                rowCount: 1,
                rows: [{
                  dimensionValues: [{ value: "20261001" }],
                  metricValues: [{ value: "25" }]
                }]
              }
            };
          }
          return {
            data: {
              rowCount: 2,
              rows: [
                {
                  dimensionValues: [{ value: "20261001" }, { value: "form_submit" }],
                  metricValues: [{ value: "3" }]
                },
                {
                  dimensionValues: [{ value: "20261001" }, { value: "Form_Submit" }],
                  metricValues: [{ value: "2" }]
                }
              ]
            }
          };
        }
      }
    })
  });

  const result = await service.syncGa4Summary({
    userId: 7,
    website,
    startDate: "2026-10-01",
    endDate: "2026-10-01"
  });

  assert.deepEqual(result, { rowsFetched: 1, rowsInserted: 1, rowsUpdated: 0 });
  assert.equal(dbPool.writes.length, 1);
  assert.deepEqual(dbPool.writes[0].params, [12, "2026-10-01", 25, 3, 2]);
  assert.deepEqual(dbPool.events.slice(-2), ["commit", "release"]);
});

test("empty GA4 reports commit without writing fabricated rows", async () => {
  const dbPool = makePool();
  const service = createGa4Service({
    dbPool,
    authorize: async () => ({}),
    createAnalyticsData: () => ({
      properties: {
        runReport: async () => ({ data: { rowCount: 0, rows: [] } })
      }
    })
  });

  const result = await service.syncGa4TrafficAcquisition({
    userId: 7,
    website,
    startDate: "2026-10-01",
    endDate: "2026-10-01"
  });

  assert.deepEqual(result, {
    rowsFetched: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    startDate: "2026-10-01",
    endDate: "2026-10-01"
  });
  assert.equal(dbPool.writes.length, 0);
  assert.deepEqual(dbPool.events, ["begin", "commit", "release"]);
});

test("traffic reports aggregate each dimension separately and calculate matching totals", async () => {
  const dbPool = makePool({
    storedRows: [
      {
        dimension_type: "source_medium",
        dimension_value: "google / organic",
        session_default_channel_group: null,
        session_source_medium: "google / organic",
        sessions: "12",
        engaged_sessions: "8"
      },
      {
        dimension_type: "source_medium",
        dimension_value: "(direct) / (none)",
        session_default_channel_group: null,
        session_source_medium: "(direct) / (none)",
        sessions: "4",
        engaged_sessions: "2"
      }
    ]
  });
  const service = createGa4Service({ dbPool });

  const report = await service.getTrafficAcquisitionReport({
    userId: 7,
    websiteId: 12,
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    dimensionType: "source_medium"
  });

  assert.deepEqual(report.total, { sessions: 16, engagedSessions: 10 });
  assert.equal(report.rows.length, 2);
  assert.equal(report.rows[0].sessionSourceMedium, "google / organic");
  assert.match(dbPool.queries[0].sql, /dimension_type = \?/);
  assert.deepEqual(dbPool.queries[0].params, [
    7,
    12,
    "source_medium",
    "2026-10-01",
    "2026-10-31"
  ]);
});

test("stored acquisition reads are scoped to user, website, dimension, and date range", async () => {
  const storedRows = [{
    report_date: "2026-10-02",
    dimension_name: "firstUserSourceMedium",
    dimension_value: "google / organic",
    dimensions_json: JSON.stringify({ firstUserSourceMedium: "google / organic" }),
    metrics_json: JSON.stringify({ totalUsers: 9 })
  }];
  const dbPool = makePool({ storedRows });
  const service = createGa4Service({ dbPool });

  const rows = await service.getGa4Acquisition({
    userId: 7,
    websiteId: 12,
    startDate: "2026-10-01",
    endDate: "2026-10-03",
    reportType: "user_acquisition",
    dimensionType: "source_medium"
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-10-02");
  assert.deepEqual(rows[0].metrics, { totalUsers: 9 });
  assert.match(dbPool.queries[0].sql, /user_id = \? AND website_id = \? AND dimension_name = \?/);
  assert.deepEqual(dbPool.queries[0].params, [
    7,
    12,
    "firstUserSourceMedium",
    "2026-10-01",
    "2026-10-03"
  ]);
});
