export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function assertDateRange(startDate, endDate, maxDays = 550) {
  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    const error = new Error("startDate and endDate must be valid dates in YYYY-MM-DD format.");
    error.status = 400;
    error.code = "INVALID_DATE";
    throw error;
  }
  if (startDate > endDate) {
    const error = new Error("startDate must be on or before endDate.");
    error.status = 400;
    error.code = "INVALID_DATE_RANGE";
    throw error;
  }
  const days = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1;
  if (days > maxDays) {
    const error = new Error(`Date range cannot exceed ${maxDays} days.`);
    error.status = 400;
    error.code = "DATE_RANGE_TOO_LARGE";
    throw error;
  }
  return { startDate, endDate, days };
}

export function dateInTimezone(timeZone = "UTC", date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function subtractMonths(dateString, months) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return date.toISOString().slice(0, 10);
}

export function chunkDateRanges(startDate, endDate, chunkDays = 30) {
  const chunks = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const chunkEnd = addDays(cursor, chunkDays - 1) < endDate ? addDays(cursor, chunkDays - 1) : endDate;
    chunks.push({ startDate: cursor, endDate: chunkEnd });
    cursor = addDays(chunkEnd, 1);
  }
  return chunks;
}

export function percentOrNull(current, previous) {
  if (previous === null || previous === undefined || Number(previous) === 0) return null;
  return ((Number(current) - Number(previous)) / Number(previous)) * 100;
}
