import { assertDateRange } from "../utils/dates.js";
import { HttpError } from "../utils/http-error.js";

const GA4_REPORT_TYPES = new Set(["summary", "user_acquisition", "traffic_acquisition"]);
const ACQUISITION_DIMENSIONS = new Set(["default_channel_group", "source_medium"]);
const KEYWORD_REPORT_SORTS = new Set([
  "keyword",
  "averagePosition",
  "previousAveragePosition",
  "positionChange",
  "clicks",
  "impressions",
  "ctr",
  "lastUpdated",
  "trackingStatus"
]);

export function parseReportDateRange(source = {}) {
  return assertDateRange(source.startDate, source.endDate);
}

export function parseKeywordId(value) {
  const keywordId = Number(value);
  if (!Number.isSafeInteger(keywordId) || keywordId <= 0) {
    throw new HttpError(400, "Invalid keyword ID.", "INVALID_KEYWORD_ID");
  }
  return keywordId;
}

export function parseKeywordReportQuery(query = {}) {
  const { startDate, endDate } = parseReportDateRange(query);
  const search = query.search === undefined ? "" : query.search;
  if (typeof search !== "string" || search.length > 500) {
    throw new HttpError(400, "search must be at most 500 characters.", "INVALID_KEYWORD_SEARCH");
  }

  const sort = query.sort === undefined ? "keyword" : query.sort;
  if (typeof sort !== "string" || !KEYWORD_REPORT_SORTS.has(sort)) {
    throw new HttpError(400, "Unsupported keyword report sort field.", "INVALID_KEYWORD_SORT");
  }

  const order = query.order === undefined ? "asc" : query.order;
  if (order !== "asc" && order !== "desc") {
    throw new HttpError(400, "order must be asc or desc.", "INVALID_KEYWORD_ORDER");
  }

  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 25 : Number(query.limit);
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new HttpError(400, "page must be a positive integer.", "INVALID_PAGINATION");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new HttpError(400, "limit must be an integer between 1 and 100.", "INVALID_PAGINATION");
  }
  if (!Number.isSafeInteger((page - 1) * limit)) {
    throw new HttpError(400, "page is too large.", "INVALID_PAGINATION");
  }

  return { startDate, endDate, search: search.trim(), sort, order, page, limit };
}

export function parseKeywordBody(body) {
  if (!body || typeof body.keyword !== "string") {
    throw new HttpError(400, "keyword must be a string.", "INVALID_KEYWORD");
  }
  return body.keyword.trim();
}

export function parseGa4ReportQuery(query = {}) {
  const reportType = query.reportType === undefined ? "summary" : query.reportType;
  if (typeof reportType !== "string" || !GA4_REPORT_TYPES.has(reportType)) {
    throw new HttpError(
      400,
      "reportType must be summary, user_acquisition, or traffic_acquisition.",
      "INVALID_REPORT_TYPE"
    );
  }

  const dimensionType = query.dimensionType === undefined
    ? "default_channel_group"
    : query.dimensionType;
  if (
    reportType !== "summary" &&
    (typeof dimensionType !== "string" || !ACQUISITION_DIMENSIONS.has(dimensionType))
  ) {
    throw new HttpError(
      400,
      "dimensionType must be default_channel_group or source_medium.",
      "INVALID_DIMENSION_TYPE"
    );
  }

  return { reportType, dimensionType };
}
