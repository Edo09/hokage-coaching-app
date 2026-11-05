/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { uuidV5 } from "@/src/lib/ids";

const DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("uuidV5", () => {
  it("matches RFC 4122 v5 vectors", () => {
    assert.equal(uuidV5("python.org", DNS), "886313e1-3b8a-5372-9b90-0c9aee199e5d");
    assert.equal(uuidV5("www.example.com", DNS), "2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });
  it("handles non-ASCII names deterministically", () => {
    assert.equal(uuidV5("comí", DNS), uuidV5("comí", DNS));
    assert.notEqual(uuidV5("comí", DNS), uuidV5("comi", DNS));
  });
});
