import { assertDateRange } from "../utils/dates.js";
import { HttpError } from "../utils/http-error.js";

const GA4_REPORT_TYPES = new Set(["summary", "user_acquisition", "traffic_acquisition"]);
const ACQUISITION_DIMENSIONS = new Set(["default_channel_group", "source_medium"]);

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
