import { HttpError } from "../utils/http-error.js";
import { reportsRepository } from "../repositories/reports.repository.js";
import { reportsService } from "./reports.service.js";

export const MAX_REPORT_ROWS = 20000;

function normalizeDate(row) {
  const value = row.report_date ?? row.date ?? null;
  return value === null ? null : String(value).slice(0, 10);
}

function normalizeUserAcquisition(row) {
  return {
    ...row,
    report_date: row.date,
    date: row.date,
    metrics: row.metrics
  };
}

function sortRows(rows, sortBy, order) {
  const direction = order === "desc" ? -1 : 1;
  return rows.sort((a, b) => {
    const valueFor = (row) => {
      if (sortBy === "date") return row.report_date ?? row.date ?? null;
      if (sortBy === "keywordId") return row.keyword_id ?? null;
      return row.metrics?.[sortBy] ?? row[sortBy] ?? null;
    };
    const left = valueFor(a);
    const right = valueFor(b);
    if (left === null || left === undefined) return right === null || right === undefined ? 0 : 1;
    if (right === null || right === undefined) return -1;
    if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
    return String(left).localeCompare(String(right)) * direction;
  });
}

function assertBounded(rows) {
  if (rows.length > MAX_REPORT_ROWS) {
    throw new HttpError(
      413,
      `The report contains more than ${MAX_REPORT_ROWS} rows. Narrow the date range or filters.`,
      "REPORT_TOO_LARGE"
    );
  }
  return rows;
}

export function createReportDataService({
  service = reportsService,
  repository = reportsRepository
} = {}) {
  async function getSourceRows({
    source,
    userId,
    website,
    startDate,
    endDate,
    filters = {},
    sortBy = "date",
    order = "asc"
  }) {
    const websiteId = website.website_id;
    const rowLimit = MAX_REPORT_ROWS + 1;
    let rows;

    if (source === "gsc") {
      rows = await service.getGscDailyPerformance({ websiteId, startDate, endDate });
    } else if (source === "ga4") {
      rows = await service.getGa4DailySummary({ websiteId, startDate, endDate });
    } else if (source === "traffic_acquisition") {
      const report = await service.getTrafficAcquisition({
        userId: website.owner_user_id ?? userId,
        websiteId,
        startDate,
        endDate,
        dimensionType: filters.dimensionType ?? "default_channel_group",
        dimensionValue: filters.dimensionValue,
        rowLimit
      });
      rows = report.rows.map((row) => ({
        ...row,
        report_date: null,
        engagementRate: row.sessions > 0 ? row.engagedSessions / row.sessions : null
      }));
    } else if (source === "user_acquisition") {
      rows = await service.getUserAcquisition({
        userId: website.owner_user_id ?? userId,
        websiteId,
        startDate,
        endDate,
        reportType: "user_acquisition",
        dimensionType: filters.dimensionType ?? "default_channel_group",
        dimensionValue: filters.dimensionValue,
        rowLimit
      });
      rows = rows.map(normalizeUserAcquisition);
    } else if (source === "keyword_tracking") {
      rows = await repository.getKeywordReportRows({
        websiteId,
        startDate,
        endDate,
        keywordId: filters.keywordId,
        keyword: filters.keyword,
        rowLimit
      });
    } else if (source === "combined") {
      const [gscRows, ga4Rows] = await Promise.all([
        service.getGscDailyPerformance({ websiteId, startDate, endDate }),
        service.getGa4DailySummary({ websiteId, startDate, endDate })
      ]);
      const byDate = new Map();
      for (const row of gscRows) {
        byDate.set(normalizeDate(row), { ...row, report_date: normalizeDate(row) });
      }
      for (const row of ga4Rows) {
        const date = normalizeDate(row);
        byDate.set(date, { ...byDate.get(date), ...row, report_date: date });
      }
      rows = [...byDate.values()].sort((a, b) => a.report_date.localeCompare(b.report_date));
    } else {
      throw new HttpError(422, "Unsupported report source.", "INVALID_SOURCE");
    }

    rows = assertBounded(rows.map((row) => ({
      ...row,
      report_date: normalizeDate(row)
    })));
    if (source === "user_acquisition" && filters.dimensionValue !== undefined) {
      rows = rows.filter((row) => row.dimensionValue === filters.dimensionValue);
    }
    if (
      source === "traffic_acquisition" &&
      filters.dimensionValue !== undefined
    ) {
      rows = rows.filter((row) => row.dimensionValue === filters.dimensionValue);
    }
    return sortRows(rows, sortBy, order);
  }

  return { getSourceRows };
}

export const reportDataService = createReportDataService();
