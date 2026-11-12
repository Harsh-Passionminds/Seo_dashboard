import test from "node:test";
import assert from "node:assert/strict";
import { normalizeKeyword } from "../src/services/gsc-keywords.service.js";

test("keyword normalization trims, collapses whitespace, and lowercases", () => {
  assert.equal(normalizeKeyword("  Digital   Marketing  "), "digital marketing");
});

test("keyword normalization handles null and empty values safely", () => {
  assert.equal(normalizeKeyword(null), "");
  assert.equal(normalizeKeyword(undefined), "");
  assert.equal(normalizeKeyword("   "), "");
});
