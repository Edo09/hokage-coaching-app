/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";

import { formatLongDate, formatShortDate } from "./dates";

test("formatShortDate: day and short month in the app language", () => {
  assert.equal(formatShortDate("2026-10-06", "es"), "6 oct");
  assert.equal(formatShortDate("2026-10-06", "en"), "Oct 6");
});

test("formatShortDate: keeps the key's calendar day (no UTC shift)", () => {
  assert.equal(formatShortDate("2026-10-01", "en"), "Oct 1");
  assert.equal(formatShortDate("2026-12-31", "es"), "31 dic");
});

test("formatLongDate: day, month and year of an instant, in the app language", () => {
  // Local noon: the same calendar day whatever the zone the test runs in.
  const noon = new Date(2026, 11, 23, 12).toISOString();
  assert.equal(formatLongDate(noon, "es"), "23 de diciembre de 2026");
  assert.equal(formatLongDate(noon, "en"), "December 23, 2026");
});

test("formatLongDate: any language but Spanish reads as English, like formatShortDate", () => {
  const noon = new Date(2026, 0, 5, 12).toISOString();
  assert.equal(formatLongDate(noon, "fr"), "January 5, 2026");
});
