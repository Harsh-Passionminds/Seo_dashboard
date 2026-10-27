import test from "node:test";
import assert from "node:assert/strict";
import { assertDateRange, addDays, subtractMonths, chunkDateRanges, percentOrNull } from "../src/utils/dates.js";

test("validates inclusive date ranges", () => {
  assert.deepEqual(assertDateRange("2026-01-01", "2026-01-03").days, 3);
});
test("rejects impossible dates and reversed ranges", () => {
  assert.throws(() => assertDateRange("2026-02-30", "2026-03-01"));
  assert.throws(() => assertDateRange("2026-03-02", "2026-03-01"));
});
test("date helpers handle month boundaries", () => {
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(subtractMonths("2026-03-31", 1), "2026-02-28");
});
test("chunks ranges without overlap or gaps", () => {
  assert.deepEqual(chunkDateRanges("2026-01-01", "2026-01-05", 2), [
    { startDate: "2026-01-01", endDate: "2026-01-02" },
    { startDate: "2026-01-03", endDate: "2026-01-04" },
    { startDate: "2026-01-05", endDate: "2026-01-05" }
  ]);
});
test("percentage comparison avoids divide by zero", () => {
  assert.equal(percentOrNull(10, 0), null);
  assert.equal(percentOrNull(15, 10), 50);
});
