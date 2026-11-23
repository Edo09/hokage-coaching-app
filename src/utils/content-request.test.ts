/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ContentRequest } from "@/src/types/database";
import {
  classifyRequestError,
  REQUEST_NOTE_MAX,
  upsertRequest,
} from "@/src/utils/content-request";

// request_content raises by message (docs/superpowers/specs/2026-11-16-premium-
// subscriptions-design.md): premium_required (SQLSTATE 42501, also for the
// coach and a signed-out caller), invalid_kind, note_too_long, already_assigned.

describe("classifyRequestError", () => {
  it("a refused request offers the paywall: access lapsed behind the screen", () => {
    assert.equal(classifyRequestError({ message: "premium_required", code: "42501" }), "premium_required");
  });

  it("a permission error alone is the same: the caller may not ask", () => {
    assert.equal(classifyRequestError({ code: "42501", message: "permission denied for function request_content" }), "premium_required");
    assert.equal(classifyRequestError({ code: "42501" }), "premium_required");
  });

  it("an assignment that already exists", () => {
    assert.equal(classifyRequestError({ message: "already_assigned", code: "P0001" }), "already_assigned");
  });

  it("a malformed request is invalid", () => {
    assert.equal(classifyRequestError({ message: "invalid_kind" }), "invalid");
    assert.equal(classifyRequestError({ message: "note_too_long" }), "invalid");
  });

  it("a lost connection is offline, however the client words it", () => {
    assert.equal(classifyRequestError(new TypeError("Failed to fetch")), "offline");
    assert.equal(classifyRequestError(new TypeError("Network request failed")), "offline");
    // supabase-js hands a failed fetch back as { message: "TypeError: …" }
    assert.equal(classifyRequestError({ message: "TypeError: Failed to fetch", code: "" }), "offline");
    assert.equal(classifyRequestError({ message: "TypeError: Network request failed" }), "offline");
  });

  it("anything else failed", () => {
    assert.equal(classifyRequestError({ message: "boom", code: "XX000" }), "failed");
    assert.equal(classifyRequestError(new Error("boom")), "failed");
    assert.equal(classifyRequestError("boom"), "failed");
    assert.equal(classifyRequestError(null), "failed");
    assert.equal(classifyRequestError(undefined), "failed");
  });

  it("the note limit is the server's", () => {
    assert.equal(REQUEST_NOTE_MAX, 500);
  });
});

function request(over: Partial<ContentRequest> = {}): ContentRequest {
  return {
    id: "r1",
    user_id: "u1",
    kind: "program",
    status: "pending",
    note: null,
    created_at: "2026-11-20T10:00:00Z",
    resolved_at: null,
    resolved_by: null,
    ...over,
  };
}

describe("upsertRequest", () => {
  it("puts a new request first", () => {
    const old = [request({ id: "a" }), request({ id: "b" })];
    assert.deepEqual(upsertRequest(old, request({ id: "c" })).map((r) => r.id), ["c", "a", "b"]);
  });

  it("replaces the request with the same id in place", () => {
    const old = [request({ id: "a" }), request({ id: "b", note: "old" })];
    const next = upsertRequest(old, request({ id: "b", note: "new" }));
    assert.deepEqual(next.map((r) => [r.id, r.note]), [["a", null], ["b", "new"]]);
  });

  it("never changes the list it was given", () => {
    const old = [request({ id: "a" })];
    const frozen = JSON.stringify(old);
    upsertRequest(old, request({ id: "a", note: "x" }));
    upsertRequest(old, request({ id: "z" }));
    assert.equal(JSON.stringify(old), frozen);
  });

  it("starts a list", () => {
    assert.deepEqual(upsertRequest([], request({ id: "a" })).map((r) => r.id), ["a"]);
  });
});
