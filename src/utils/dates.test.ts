/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";

import { formatShortDate } from "./dates";

test("formatShortDate: day and short month in the app language", () => {
  assert.equal(formatShortDate("2026-10-06", "es"), "6 oct");
  assert.equal(formatShortDate("2026-10-06", "en"), "Oct 6");
});

test("formatShortDate: keeps the key's calendar day (no UTC shift)", () => {
  assert.equal(formatShortDate("2026-10-01", "en"), "Oct 1");
  assert.equal(formatShortDate("2026-12-31", "es"), "31 dic");
});
