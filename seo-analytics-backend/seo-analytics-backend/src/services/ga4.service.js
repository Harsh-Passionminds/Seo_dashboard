import { google } from "googleapis";
import { pool } from "../db/pool.js";
import { getAuthorizedGoogleClient } from "./google-oauth.service.js";
import { HttpError } from "../utils/http-error.js";

const PAGE_SIZE = 100000;
const ACQUISITION_REPORTS = {
  user_acquisition: {
    table: "user_acquisition_data",
    dimensions: {
      default_channel_group: "firstUserDefaultChannelGroup",
      source_medium: "firstUserSourceMedium"
    },
    metrics: [
      "totalUsers",
      "newUsers",
      "activeUsers",
      "engagedSessions",
      "engagementRate",
      "averageSessionDuration",
      "conversions",
      "totalRevenue"
    ]
  }
};

const TRAFFIC_DIMENSIONS = {
  default_channel_group: "sessionDefaultChannelGroup",
  source_medium: "sessionSourceMedium"
};

function validateId(value, name) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(400, `${name} must be a positive integer.`, "INVALID_ID");
  }
  return id;
}

function validateDate(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${name} must use YYYY-MM-DD format.`, "INVALID_DATE");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${name} is not a valid date.`, "INVALID_DATE");
  }
  return value;
}

function validateDateRange(startDate, endDate) {
  validateDate(startDate, "startDate");
  validateDate(endDate, "endDate");
  if (startDate > endDate) {
    throw new HttpError(400, "startDate cannot be later than endDate.", "INVALID_DATE_RANGE");
  }
}

function getAcquisitionConfig(reportType, dimensionType) {
  const report = Object.hasOwn(ACQUISITION_REPORTS, reportType)
    ? ACQUISITION_REPORTS[reportType]
    : null;
  if (!report) {
    throw new HttpError(
      400,
      "reportType must be user_acquisition.",
      "INVALID_REPORT_TYPE"
    );
  }
  const dimensionName = Object.hasOwn(report.dimensions, dimensionType)
    ? report.dimensions[dimensionType]
    : null;
  if (!dimensionName) {
    throw new HttpError(
      400,
      "dimensionType must be default_channel_group or source_medium.",
      "INVALID_DIMENSION_TYPE"
    );
  }
  return { ...report, dimensionType, dimensionName };
}

function getAcquisitionReportTypes(reportType, dimensionType) {
  if (dimensionType !== undefined && dimensionType !== null) {
    return [getAcquisitionConfig(reportType, dimensionType)];
  }
  const report = Object.hasOwn(ACQUISITION_REPORTS, reportType)
    ? ACQUISITION_REPORTS[reportType]
    : null;
  if (!report) {
    throw new HttpError(
      400,
      "reportType must be user_acquisition.",
      "INVALID_REPORT_TYPE"
    );
  }
  return Object.keys(report.dimensions).map((type) => getAcquisitionConfig(reportType, type));
}

function validateSyncWebsite(userId, website) {
  if (!website || website.website_id == null) {
    throw new HttpError(400, "Website is required.", "WEBSITE_REQUIRED");
  }
  const websiteId = validateId(website.website_id, "websiteId");
  if (website.owner_user_id == null || Number(website.owner_user_id) !== userId) {
    throw new HttpError(403, "You are not authorized to sync this website.", "WEBSITE_FORBIDDEN");
  }
  const propertyId = String(website.ga4_property_id ?? "").trim();
  if (!/^\d+$/.test(propertyId)) {
    throw new HttpError(400, "This website has no valid GA4 property ID.", "GA4_PROPERTY_MISSING");
  }
  return { websiteId, propertyId };
}

function convertGa4Date(value) {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) {
    throw new HttpError(502, "GA4 returned a row with an invalid date.", "GA4_INVALID_RESPONSE");
  }
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  validateDate(date, "GA4 report date");
  return date;
}

function getMetricValues(row, metricNames) {
  if (!Array.isArray(row.metricValues) || row.metricValues.length !== metricNames.length) {
    throw new HttpError(502, "GA4 returned an incomplete metrics row.", "GA4_INVALID_RESPONSE");
  }
  return Object.fromEntries(metricNames.map((name, index) => {
    const value = Number(row.metricValues[index]?.value ?? 0);
    if (!Number.isFinite(value)) {
      throw new HttpError(502, `GA4 returned an invalid ${name} metric.`, "GA4_INVALID_RESPONSE");
    }
    return [name, value];
  }));
}

function affectedCounts(result) {
  if (result.affectedRows === 1) return { inserted: 1, updated: 0 };
  if (result.affectedRows === 2) return { inserted: 0, updated: 1 };
  return { inserted: 0, updated: 0 };
}

async function rollbackOrThrow(connection, originalError) {
  try {
    await connection.rollback();
  } catch (rollbackError) {
    throw new AggregateError(
      [originalError, rollbackError],
      "The database operation failed and its transaction could not be rolled back."
    );
  }
  throw originalError;
}

function wrapGa4Error(error) {
  if (error instanceof HttpError) return error;
  const status = Number(error?.response?.status ?? error?.code);
  const googleMessage = error?.response?.data?.error?.message ?? error?.message;
  const message = typeof googleMessage === "string" && googleMessage
    ? googleMessage
    : "Google Analytics Data API request failed.";
  const code = status === 429
    ? "GA4_QUOTA_EXCEEDED"
    : status === 400
      ? "GA4_INVALID_REPORT"
      : "GA4_REQUEST_FAILED";
  return new HttpError(status === 429 ? 429 : 502, `GA4 report failed: ${message}`, code);
}

export function createGa4Service({
  dbPool = pool,
  authorize = getAuthorizedGoogleClient,
  createAnalyticsData = (auth) => google.analyticsdata({ version: "v1beta", auth }),
  pageSize = PAGE_SIZE
} = {}) {
  async function fetchAllReportRows({
    analyticsData,
    propertyId,
    startDate,
    endDate,
    dimensions,
    metrics,
    dimensionFilter
  }) {
    const rows = [];
    let offset = 0;
    let expectedRowCount = null;

    while (true) {
      let response;
      try {
        response = await analyticsData.properties.runReport({
          property: `properties/${propertyId}`,
          requestBody: {
            dateRanges: [{ startDate, endDate }],
            dimensions: dimensions.map((name) => ({ name })),
            metrics: metrics.map((name) => ({ name })),
            orderBys: dimensions.map((dimensionName) => ({
              dimension: { dimensionName }
            })),
            ...(dimensionFilter ? { dimensionFilter } : {}),
            limit: String(pageSize),
            offset: String(offset),
            keepEmptyRows: false
          }
        });
      } catch (error) {
        throw wrapGa4Error(error);
      }

      const report = response?.data;
      if (!report || typeof report !== "object") {
        throw new HttpError(502, "GA4 returned an invalid report.", "GA4_INVALID_RESPONSE");
      }
      const pageRows = report.rows ?? [];
      if (!Array.isArray(pageRows)) {
        throw new HttpError(502, "GA4 returned an invalid report.", "GA4_INVALID_RESPONSE");
      }
      if (expectedRowCount === null) {
        const reportedCount = Number(report.rowCount);
        expectedRowCount = Number.isSafeInteger(reportedCount) && reportedCount >= 0
          ? reportedCount
          : null;
      }
      rows.push(...pageRows);
      offset += pageRows.length;

      if (pageRows.length === 0) break;
      if (expectedRowCount !== null && offset >= expectedRowCount) break;
      if (expectedRowCount === null && pageRows.length < pageSize) break;
    }

    return rows;
  }

  async function fetchAcquisitionRows(analyticsData, propertyId, startDate, endDate, config) {
    const rows = await fetchAllReportRows({
      analyticsData,
      propertyId,
      startDate,
      endDate,
      dimensions: ["date", config.dimensionName],
      metrics: config.metrics
    });
    return rows.map((row) => {
      if (!Array.isArray(row.dimensionValues) || row.dimensionValues.length !== 2) {
        throw new HttpError(502, "GA4 returned an incomplete dimensions row.", "GA4_INVALID_RESPONSE");
      }
      const reportDate = convertGa4Date(row.dimensionValues[0]?.value);
      const dimensionValue = row.dimensionValues[1]?.value;
      if (typeof dimensionValue !== "string" || dimensionValue.length > 512) {
        throw new HttpError(502, "GA4 returned an invalid acquisition dimension.", "GA4_INVALID_RESPONSE");
      }
      const dimensions = { date: reportDate, [config.dimensionName]: dimensionValue };
      return {
        reportDate,
        dimensionValue,
        dimensions,
        metrics: getMetricValues(row, config.metrics)
      };
    });
  }

  async function fetchTrafficRows(analyticsData, propertyId, startDate, endDate, dimensionType) {
    const dimensionName = TRAFFIC_DIMENSIONS[dimensionType];
    const rows = await fetchAllReportRows({
      analyticsData,
      propertyId,
      startDate,
      endDate,
      dimensions: ["date", dimensionName],
      metrics: ["sessions", "engagedSessions"]
    });
    return rows.map((row) => {
      if (!Array.isArray(row.dimensionValues) || row.dimensionValues.length !== 2) {
        throw new HttpError(502, "GA4 returned an incomplete traffic dimensions row.", "GA4_INVALID_RESPONSE");
      }
      const reportDate = convertGa4Date(row.dimensionValues[0]?.value);
      const dimensionValue = row.dimensionValues[1]?.value;
      if (typeof dimensionValue !== "string" || dimensionValue.length > 512) {
        throw new HttpError(502, "GA4 returned an invalid traffic dimension.", "GA4_INVALID_RESPONSE");
      }
      const metrics = getMetricValues(row, ["sessions", "engagedSessions"]);
      if (
        !Number.isSafeInteger(metrics.sessions) ||
        !Number.isSafeInteger(metrics.engagedSessions) ||
        metrics.sessions < 0 ||
        metrics.engagedSessions < 0
      ) {
        throw new HttpError(502, "GA4 returned invalid traffic counts.", "GA4_INVALID_RESPONSE");
      }
      return { reportDate, dimensionValue, ...metrics };
    });
  }

  async function syncGa4TrafficAcquisition({ userId, website, startDate, endDate }) {
    const normalizedUserId = validateId(userId, "userId");
    validateDateRange(startDate, endDate);
    const { websiteId, propertyId } = validateSyncWebsite(normalizedUserId, website);
    const auth = await authorize(normalizedUserId);
    const analyticsData = createAnalyticsData(auth);
    const rowsByDimension = [];

    for (const dimensionType of Object.keys(TRAFFIC_DIMENSIONS)) {
      const rows = await fetchTrafficRows(
        analyticsData,
        propertyId,
        startDate,
        endDate,
        dimensionType
      );
      rowsByDimension.push({ dimensionType, rows });
    }

    const connection = await dbPool.getConnection();
    let rowsFetched = 0;
    let rowsInserted = 0;
    let rowsUpdated = 0;
    try {
      await connection.beginTransaction();
      for (const { dimensionType, rows } of rowsByDimension) {
        for (const row of rows) {
          const channelGroup = dimensionType === "default_channel_group"
            ? row.dimensionValue
            : null;
          const sourceMedium = dimensionType === "source_medium"
            ? row.dimensionValue
            : null;
          const [result] = await connection.execute(
            `INSERT INTO ga4_traffic_acquisition_data (
               user_id, website_id, report_date, dimension_type, dimension_value,
               session_default_channel_group, session_source_medium, sessions, engaged_sessions
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               session_default_channel_group = VALUES(session_default_channel_group),
               session_source_medium = VALUES(session_source_medium),
               sessions = VALUES(sessions),
               engaged_sessions = VALUES(engaged_sessions),
               updated_at = CURRENT_TIMESTAMP`,
            [
              normalizedUserId,
              websiteId,
              row.reportDate,
              dimensionType,
              row.dimensionValue,
              channelGroup,
              sourceMedium,
              row.sessions,
              row.engagedSessions
            ]
          );
          const counts = affectedCounts(result);
          rowsFetched += 1;
          rowsInserted += counts.inserted;
          rowsUpdated += counts.updated;
        }
      }
      await connection.commit();
    } catch (error) {
      await rollbackOrThrow(connection, error);
    } finally {
      connection.release();
    }

    return {
      rowsFetched,
      rowsInserted,
      rowsUpdated,
      startDate,
      endDate
    };
  }

  async function getTrafficAcquisitionReport({
    userId,
    websiteId,
    startDate,
    endDate,
    dimensionType,
    dimensionValue,
    rowLimit
  }) {
    const normalizedUserId = validateId(userId, "userId");
    const normalizedWebsiteId = validateId(websiteId, "websiteId");
    validateDateRange(startDate, endDate);
    if (!Object.hasOwn(TRAFFIC_DIMENSIONS, dimensionType)) {
      throw new HttpError(
        400,
        "dimensionType must be default_channel_group or source_medium.",
        "INVALID_DIMENSION_TYPE"
      );
    }

    if (rowLimit !== undefined && (!Number.isSafeInteger(rowLimit) || rowLimit < 1 || rowLimit > 20001)) {
      throw new HttpError(400, "rowLimit must be an integer from 1 to 20001.", "INVALID_ROW_LIMIT");
    }
    const valueFilter = dimensionValue === undefined ? "" : " AND dimension_value = ?";
    const limitClause = rowLimit === undefined ? "" : " LIMIT ?";
    const parameters = [
      normalizedUserId,
      normalizedWebsiteId,
      dimensionType,
      startDate,
      endDate,
      ...(dimensionValue === undefined ? [] : [dimensionValue]),
      ...(rowLimit === undefined ? [] : [rowLimit])
    ];
    const [storedRows] = await dbPool.execute(
      `SELECT dimension_type, dimension_value, session_default_channel_group,
              session_source_medium, SUM(sessions) AS sessions,
              SUM(engaged_sessions) AS engaged_sessions
       FROM ga4_traffic_acquisition_data
       WHERE user_id = ? AND website_id = ? AND dimension_type = ?
         AND report_date BETWEEN ? AND ?${valueFilter}
       GROUP BY dimension_type, dimension_value,
                session_default_channel_group, session_source_medium
       ORDER BY sessions DESC, dimension_value ASC${limitClause}`,
      parameters
    );
    const rows = storedRows.map((row) => ({
      dimensionType: row.dimension_type,
      dimensionValue: row.dimension_value,
      sessionDefaultChannelGroup: row.session_default_channel_group,
      sessionSourceMedium: row.session_source_medium,
      sessions: Number(row.sessions),
      engagedSessions: Number(row.engaged_sessions)
    }));
    const total = rows.reduce(
      (sum, row) => ({
        sessions: sum.sessions + row.sessions,
        engagedSessions: sum.engagedSessions + row.engagedSessions
      }),
      { sessions: 0, engagedSessions: 0 }
    );

    return { rows, total };
  }

  async function syncGa4Summary({ userId, website, startDate, endDate }) {
    const normalizedUserId = validateId(userId, "userId");
    validateDateRange(startDate, endDate);
    const { websiteId, propertyId } = validateSyncWebsite(normalizedUserId, website);
    const auth = await authorize(normalizedUserId);
    const analyticsData = createAnalyticsData(auth);
    const [sessionRows, eventRows] = await Promise.all([
      fetchAllReportRows({
        analyticsData,
        propertyId,
        startDate,
        endDate,
        dimensions: ["date"],
        metrics: ["sessions"],
        dimensionFilter: {
          filter: {
            fieldName: "sessionDefaultChannelGroup",
            stringFilter: { matchType: "EXACT", value: "Organic Search" }
          }
        }
      }),
      fetchAllReportRows({
        analyticsData,
        propertyId,
        startDate,
        endDate,
        dimensions: ["date", "eventName"],
        metrics: ["eventCount"],
        dimensionFilter: {
          filter: {
            fieldName: "eventName",
            inListFilter: { values: ["form_submit", "Form_Submit"], caseSensitive: true }
          }
        }
      })
    ]);

    const daily = new Map();
    for (const row of sessionRows) {
      if (!Array.isArray(row.dimensionValues) || row.dimensionValues.length !== 1) {
        throw new HttpError(502, "GA4 returned an incomplete summary dimensions row.", "GA4_INVALID_RESPONSE");
      }
      const date = convertGa4Date(row.dimensionValues?.[0]?.value);
      const organicSessions = getMetricValues(row, ["sessions"]).sessions;
      daily.set(date, {
        organic_sessions: organicSessions,
        form_submit_conversions: 0,
        from_submit_conversions: 0
      });
    }
    for (const row of eventRows) {
      if (!Array.isArray(row.dimensionValues) || row.dimensionValues.length !== 2) {
        throw new HttpError(502, "GA4 returned an incomplete event dimensions row.", "GA4_INVALID_RESPONSE");
      }
      const date = convertGa4Date(row.dimensionValues?.[0]?.value);
      const eventName = row.dimensionValues?.[1]?.value;
      const entry = daily.get(date) ?? {
        organic_sessions: 0,
        form_submit_conversions: 0,
        from_submit_conversions: 0
      };
      const eventCount = getMetricValues(row, ["eventCount"]).eventCount;
      if (eventName === "form_submit") entry.form_submit_conversions = eventCount;
      if (eventName === "Form_Submit") entry.from_submit_conversions = eventCount;
      daily.set(date, entry);
    }

    const connection = await dbPool.getConnection();
    let rowsInserted = 0;
    let rowsUpdated = 0;
    try {
      await connection.beginTransaction();
      for (const [reportDate, values] of daily) {
        const [result] = await connection.execute(
          `INSERT INTO google_analytics_data
             (website_id, report_date, organic_sessions, form_submit_conversions, from_submit_conversions)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             organic_sessions = VALUES(organic_sessions),
             form_submit_conversions = VALUES(form_submit_conversions),
             from_submit_conversions = VALUES(from_submit_conversions),
             updated_at = CURRENT_TIMESTAMP`,
          [
            websiteId,
            reportDate,
            values.organic_sessions,
            values.form_submit_conversions,
            values.from_submit_conversions
          ]
        );
        const counts = affectedCounts(result);
        rowsInserted += counts.inserted;
        rowsUpdated += counts.updated;
      }
      await connection.commit();
    } catch (error) {
      await rollbackOrThrow(connection, error);
    } finally {
      connection.release();
    }

    return {
      rowsFetched: daily.size,
      rowsInserted,
      rowsUpdated
    };
  }

  async function syncGa4Acquisition({
    userId,
    website,
    startDate,
    endDate,
    reportType,
    dimensionType
  }) {
    const normalizedUserId = validateId(userId, "userId");
    validateDateRange(startDate, endDate);
    const { websiteId, propertyId } = validateSyncWebsite(normalizedUserId, website);
    const configs = getAcquisitionReportTypes(reportType, dimensionType);
    const auth = await authorize(normalizedUserId);
    const analyticsData = createAnalyticsData(auth);
    const rowsByConfig = [];

    for (const config of configs) {
      const rows = await fetchAcquisitionRows(
        analyticsData,
        propertyId,
        startDate,
        endDate,
        config
      );
      rowsByConfig.push({ config, rows });
    }

    const connection = await dbPool.getConnection();
    let rowsFetched = 0;
    let rowsInserted = 0;
    let rowsUpdated = 0;
    try {
      await connection.beginTransaction();
      for (const { config, rows } of rowsByConfig) {
        const sql = `
          INSERT INTO ${config.table} (
            user_id, website_id, report_date, dimension_name, dimension_value,
            metrics_json, dimensions_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            user_id = VALUES(user_id),
            metrics_json = VALUES(metrics_json),
            dimensions_json = VALUES(dimensions_json),
            updated_at = CURRENT_TIMESTAMP
        `;
        for (const row of rows) {
          const [result] = await connection.execute(sql, [
            normalizedUserId,
            websiteId,
            row.reportDate,
            config.dimensionName,
            row.dimensionValue,
            JSON.stringify(row.metrics),
            JSON.stringify(row.dimensions)
          ]);
          const counts = affectedCounts(result);
          rowsInserted += counts.inserted;
          rowsUpdated += counts.updated;
          rowsFetched += 1;
        }
      }
      await connection.commit();
    } catch (error) {
      await rollbackOrThrow(connection, error);
    } finally {
      connection.release();
    }

    return { rowsFetched, rowsInserted, rowsUpdated };
  }

  async function getGa4Acquisition({
    userId,
    websiteId,
    startDate,
    endDate,
    reportType,
    dimensionType = "default_channel_group",
    dimensionValue,
    rowLimit
  }) {
    const normalizedUserId = validateId(userId, "userId");
    const normalizedWebsiteId = validateId(websiteId, "websiteId");
    validateDateRange(startDate, endDate);
    const config = getAcquisitionConfig(reportType, dimensionType);
    if (rowLimit !== undefined && (!Number.isSafeInteger(rowLimit) || rowLimit < 1 || rowLimit > 20001)) {
      throw new HttpError(400, "rowLimit must be an integer from 1 to 20001.", "INVALID_ROW_LIMIT");
    }
    const valueFilter = dimensionValue === undefined ? "" : " AND dimension_value = ?";
    const limitClause = rowLimit === undefined ? "" : " LIMIT ?";
    const parameters = [
      normalizedUserId,
      normalizedWebsiteId,
      config.dimensionName,
      startDate,
      endDate,
      ...(dimensionValue === undefined ? [] : [dimensionValue]),
      ...(rowLimit === undefined ? [] : [rowLimit])
    ];
    const [rows] = await dbPool.execute(
      `SELECT report_date, dimension_name, dimension_value, dimensions_json, metrics_json
       FROM ${config.table}
       WHERE user_id = ? AND website_id = ? AND dimension_name = ?
         AND report_date BETWEEN ? AND ?${valueFilter}
       ORDER BY report_date ASC, dimension_value ASC${limitClause}`,
      parameters
    );
    return rows.map((row) => ({
      date: String(row.report_date).slice(0, 10),
      dimensionName: row.dimension_name,
      dimensionValue: row.dimension_value,
      dimensions: typeof row.dimensions_json === "string"
        ? JSON.parse(row.dimensions_json)
        : row.dimensions_json,
      metrics: typeof row.metrics_json === "string"
        ? JSON.parse(row.metrics_json)
        : row.metrics_json
    }));
  }

  return {
    syncGa4Summary,
    syncGa4Acquisition,
    syncGa4TrafficAcquisition,
    getGa4Acquisition,
    getTrafficAcquisitionReport
  };
}

const ga4Service = createGa4Service();
export const {
  syncGa4Summary,
  syncGa4Acquisition,
  syncGa4TrafficAcquisition,
  getGa4Acquisition,
  getTrafficAcquisitionReport
} = ga4Service;
