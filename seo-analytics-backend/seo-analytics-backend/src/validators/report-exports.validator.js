import { assertDateRange } from "../utils/dates.js";
import { HttpError } from "../utils/http-error.js";

const SOURCE_METRICS = {
  gsc: ["clicks", "impressions", "ctr", "average_position"],
  ga4: [
    "organic_sessions",
    "form_submit_conversions",
    "from_submit_conversions",
    "total_form_conversions"
  ],
  user_acquisition: [
    "totalUsers",
    "newUsers",
    "activeUsers",
    "engagedSessions",
    "engagementRate",
    "averageSessionDuration",
    "conversions",
    "totalRevenue"
  ],
  traffic_acquisition: ["sessions", "engagedSessions", "engagementRate"],
  keyword_tracking: ["clicks", "impressions", "ctr", "average_position"],
  combined: [
    "clicks",
    "impressions",
    "ctr",
    "average_position",
    "organic_sessions",
    "form_submit_conversions",
    "from_submit_conversions",
    "total_form_conversions"
  ]
};

const SOURCE_DIMENSIONS = {
  gsc: ["date"],
  ga4: ["date"],
  user_acquisition: ["date", "dimensionValue"],
  traffic_acquisition: ["dimensionValue", "dimensionType"],
  keyword_tracking: ["date", "keywordId", "keyword"],
  combined: ["date"]
};

const FILTER_KEYS = {
  gsc: [],
  ga4: [],
  user_acquisition: ["dimensionType", "dimensionValue"],
  traffic_acquisition: ["dimensionType", "dimensionValue"],
  keyword_tracking: ["keywordId", "keyword"],
  combined: []
};

const AVAILABLE_BUT_UNSTORED_SOURCES = new Set(["visitor_entry", "landing_pages"]);
const DIMENSION_TYPES = new Set(["default_channel_group", "source_medium"]);
const COMPARISON_MODES = new Set([
  "previous_period",
  "previous_week",
  "previous_month",
  "previous_year",
  "custom"
]);

function validationError(message, code = "VALIDATION_ERROR") {
  throw new HttpError(422, message, code);
}

function parseSource(source) {
  if (typeof source !== "string" || !Object.hasOwn(SOURCE_METRICS, source)) {
    if (typeof source === "string" && AVAILABLE_BUT_UNSTORED_SOURCES.has(source)) {
      validationError(
        `The ${source} report source is unavailable because this database has no persisted ${source} data.`,
        "REPORT_SOURCE_UNAVAILABLE"
      );
    }
    validationError("source must be gsc, ga4, user_acquisition, traffic_acquisition, keyword_tracking, or combined.");
  }
  return source;
}

function parseList(value, field, allowed, defaults) {
  if (value === undefined || value === "") return defaults;
  if (typeof value !== "string") validationError(`${field} must be a comma-separated list.`);
  const items = value.split(",").map((item) => item.trim());
  if (items.some((item) => !item) || new Set(items).size !== items.length) {
    validationError(`${field} must contain unique, non-empty values.`);
  }
  const invalid = items.find((item) => !allowed.includes(item));
  if (invalid) validationError(`${field} contains unsupported value: ${invalid}.`);
  return items;
}

function parseFilters(value, source) {
  if (value === undefined || value === "") return {};
  if (typeof value !== "string" || value.length > 4000) {
    validationError("filters must be a JSON object no larger than 4000 characters.");
  }
  let filters;
  try {
    filters = JSON.parse(value);
  } catch {
    validationError("filters must contain valid JSON.");
  }
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    validationError("filters must be a JSON object.");
  }
  const allowed = FILTER_KEYS[source];
  for (const [key, filterValue] of Object.entries(filters)) {
    if (!allowed.includes(key)) validationError(`filters.${key} is not supported for ${source}.`);
    if (key === "dimensionType" && !DIMENSION_TYPES.has(filterValue)) {
      validationError("filters.dimensionType must be default_channel_group or source_medium.");
    }
    if (key === "dimensionValue" || key === "keyword") {
      if (typeof filterValue !== "string" || !filterValue.trim() || filterValue.length > 512) {
        validationError(`filters.${key} must be a non-empty string of at most 512 characters.`);
      }
      filters[key] = filterValue.trim();
    }
    if (key === "keywordId") {
      const id = Number(filterValue);
      if (!Number.isSafeInteger(id) || id <= 0) {
        validationError("filters.keywordId must be a positive safe integer.");
      }
      filters[key] = id;
    }
  }
  return filters;
}

function parseReportOptions(query, { includeFormat = false } = {}) {
  const source = parseSource(query.source);
  const metrics = parseList(query.metrics, "metrics", SOURCE_METRICS[source], SOURCE_METRICS[source]);
  const defaultDimensions = SOURCE_DIMENSIONS[source];
  const dimensions = query.dimensions === undefined && query.groupBy !== undefined
    ? parseList(query.groupBy, "groupBy", SOURCE_DIMENSIONS[source], defaultDimensions)
    : parseList(query.dimensions, "dimensions", SOURCE_DIMENSIONS[source], defaultDimensions);
  const groupBy = query.groupBy === undefined
    ? dimensions
    : parseList(query.groupBy, "groupBy", SOURCE_DIMENSIONS[source], dimensions);
  if (
    query.dimensions !== undefined &&
    query.groupBy !== undefined &&
    dimensions.join(",") !== groupBy.join(",")
  ) {
    validationError("dimensions and groupBy must match when both are supplied.");
  }
  const filters = parseFilters(query.filters, source);
  const sortBy = query.sortBy ?? (dimensions.includes("date") ? "date" : dimensions[0]);
  if (typeof sortBy !== "string" || ![...SOURCE_METRICS[source], ...SOURCE_DIMENSIONS[source]].includes(sortBy)) {
    validationError("sortBy must be a supported metric or dimension for the selected source.");
  }
  const order = query.order ?? "asc";
  if (order !== "asc" && order !== "desc") validationError("order must be asc or desc.");

  const options = { source, metrics, dimensions, groupBy, filters, sortBy, order };
  if (includeFormat) {
    const format = query.format ?? "csv";
    if (format !== "csv" && format !== "xlsx") validationError("format must be csv or xlsx.");
    options.format = format;
  }
  return options;
}

function requiredDateRange(source, startField, endField) {
  const { startDate, endDate } = assertDateRange(source[startField], source[endField]);
  return { startDate, endDate };
}

function dateToUtc(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function addCalendarDays(value, days) {
  const date = dateToUtc(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDate(date);
}

function lastDayOfMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function parseComparisonPeriod(query) {
  const current = requiredDateRange(query, "currentStartDate", "currentEndDate");
  const compareStartProvided = query.compareStartDate !== undefined;
  const compareEndProvided = query.compareEndDate !== undefined;
  if (compareStartProvided !== compareEndProvided) {
    validationError("compareStartDate and compareEndDate must be supplied together.", "INVALID_COMPARISON_RANGE");
  }

  let comparison;
  let comparisonMode = query.comparisonMode;
  if (compareStartProvided) {
    comparison = requiredDateRange(query, "compareStartDate", "compareEndDate");
    if (comparisonMode !== undefined && comparisonMode !== "custom") {
      validationError("Explicit comparison dates cannot be combined with a non-custom comparisonMode.", "INVALID_COMPARISON_MODE");
    }
    comparisonMode = "custom";
    if (current.startDate <= comparison.endDate && comparison.startDate <= current.endDate) {
      validationError("Current and comparison periods must not overlap.", "INVALID_COMPARISON_RANGE");
    }
  } else {
    comparisonMode ??= "previous_period";
    if (!COMPARISON_MODES.has(comparisonMode) || comparisonMode === "custom") {
      validationError(
        "comparisonMode must be previous_period, previous_week, previous_month, previous_year, or use explicit custom dates.",
        "INVALID_COMPARISON_MODE"
      );
    }
    const currentStart = dateToUtc(current.startDate);
    const currentEnd = dateToUtc(current.endDate);
    const dayCount = Math.floor((currentEnd - currentStart) / 86400000) + 1;
    if (comparisonMode === "previous_period") {
      comparison = {
        startDate: addCalendarDays(current.startDate, -dayCount),
        endDate: addCalendarDays(current.startDate, -1)
      };
    } else if (comparisonMode === "previous_week") {
      const weekDay = currentStart.getUTCDay();
      const mondayOffset = weekDay === 0 ? -6 : 1 - weekDay;
      const weekStart = addCalendarDays(current.startDate, mondayOffset);
      if (current.startDate !== weekStart || dayCount > 7) {
        validationError("previous_week requires a current period starting Monday and lasting at most seven days.", "INVALID_COMPARISON_RANGE");
      }
      comparison = {
        startDate: addCalendarDays(current.startDate, -7),
        endDate: addCalendarDays(current.endDate, -7)
      };
    } else if (comparisonMode === "previous_month") {
      const year = currentStart.getUTCFullYear();
      const month = currentStart.getUTCMonth();
      if (currentStart.getUTCDate() !== 1 || currentEnd.getUTCFullYear() !== year || currentEnd.getUTCMonth() !== month) {
        validationError("previous_month requires a current period starting on the first day of one calendar month.", "INVALID_COMPARISON_RANGE");
      }
      const previousMonthDate = new Date(Date.UTC(year, month - 1, 1));
      const previousYear = previousMonthDate.getUTCFullYear();
      const previousMonth = previousMonthDate.getUTCMonth();
      const endDay = Math.min(currentEnd.getUTCDate(), lastDayOfMonth(previousYear, previousMonth));
      comparison = {
        startDate: formatUtcDate(previousMonthDate),
        endDate: `${previousYear}-${String(previousMonth + 1).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`
      };
    } else {
      const year = currentStart.getUTCFullYear();
      if (currentStart.getUTCMonth() !== 0 || currentStart.getUTCDate() !== 1 || currentEnd.getUTCFullYear() !== year) {
        validationError("previous_year requires a current period starting January 1 and ending within the same year.", "INVALID_COMPARISON_RANGE");
      }
      const previousYear = year - 1;
      const day = Math.min(currentEnd.getUTCDate(), lastDayOfMonth(
        previousYear,
        currentEnd.getUTCMonth()
      ));
      comparison = {
        startDate: `${previousYear}-01-01`,
        endDate: `${previousYear}-${String(currentEnd.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      };
    }
  }
  assertDateRange(current.startDate, current.endDate);
  assertDateRange(comparison.startDate, comparison.endDate);
  return { current, comparison, comparisonMode };
}

export function parseComparisonQuery(query) {
  return {
    ...parseReportOptions(query),
    ...parseComparisonPeriod(query)
  };
}

export function parseExportQuery(query) {
  return {
    ...parseReportOptions(query, { includeFormat: true }),
    ...requiredDateRange(query, "startDate", "endDate")
  };
}

export const reportExportValidation = Object.freeze({
  metrics: SOURCE_METRICS,
  dimensions: SOURCE_DIMENSIONS,
  sources: Object.keys(SOURCE_METRICS),
  unavailableSources: [...AVAILABLE_BUT_UNSTORED_SOURCES]
});
