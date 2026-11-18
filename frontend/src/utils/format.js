import { format, parseISO, subDays, differenceInCalendarDays } from "date-fns";

export const toNum = (v) => {
  if (v == null || v === "") return null;
  const number = Number(v);
  return Number.isFinite(number) ? number : null;
};
export const fmtInt = (v) => {
  const number = toNum(v);
  return number == null ? "No data" : number.toLocaleString();
};
export const fmtPct = (v, d = 1) => {
  const number = toNum(v);
  return number == null ? "No data" : (number * 100).toFixed(d) + "%";
};
export const fmtPos = (v) => {
  const number = toNum(v);
  return number == null ? "No data" : number.toFixed(1);
};

export function previousRange(r) {
  const days = differenceInCalendarDays(parseISO(r.endDate), parseISO(r.startDate)) + 1;
  const end = subDays(parseISO(r.startDate), 1);
  const start = subDays(end, days - 1);
  return { startDate: format(start, "yyyy-MM-dd"), endDate: format(end, "yyyy-MM-dd") };
}

export function change(cur, prev) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return { abs: null, pct: null };
  return { abs: cur - prev, pct: prev ? (cur - prev) / prev : null };
}

export function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}