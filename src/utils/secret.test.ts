/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
// Covers the shared-secret helpers of the Edge Functions the database or
// RevenueCat calls with a secret instead of a Supabase token (estimate-meal,
// revenuecat-webhook). The module has no imports so Deno and this runner can
// both load it.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { sameSecret, verifySignature } from "@/supabase/functions/_shared/secret";

describe("sameSecret", () => {
  it("accepts the same secret", () => {
    assert.equal(sameSecret("s3cret-value", "s3cret-value"), true);
  });

  it("refuses a different secret of the same length", () => {
    assert.equal(sameSecret("s3cret-value", "s3cret-valuf"), false);
  });

  it("refuses a secret that is a prefix of the real one, and the reverse", () => {
    assert.equal(sameSecret("s3cret", "s3cret-value"), false);
    assert.equal(sameSecret("s3cret-value", "s3cret"), false);
  });

  it("refuses an empty value against a real secret", () => {
    assert.equal(sameSecret("", "s3cret-value"), false);
  });
});

describe("verifySignature", () => {
  const secret = "whsec_test";
  const body = '{"event":{"id":"evt_1","type":"RENEWAL"}}';
  const now = 1_800_000_000;
  const mac = (t: number, b = body, s = secret) => createHmac("sha256", s).update(`${t}.${b}`).digest("hex");
  const header = (t: number, b = body, s = secret) => `t=${t},v1=${mac(t, b, s)}`;

  it("accepts a header built the documented way", async () => {
    assert.equal(await verifySignature(header(now), body, secret, now), true);
  });

  it("accepts a timestamp inside the tolerance, in the past and in the future", async () => {
    assert.equal(await verifySignature(header(now - 299), body, secret, now), true);
    assert.equal(await verifySignature(header(now + 299), body, secret, now), true);
  });

  it("refuses the wrong secret", async () => {
    assert.equal(await verifySignature(header(now, body, "other"), body, secret, now), false);
  });

  it("refuses a tampered body", async () => {
    assert.equal(await verifySignature(header(now), body.replace("RENEWAL", "EXPIRATION"), secret, now), false);
  });

  it("refuses a timestamp 301 seconds old, and one 301 seconds ahead", async () => {
    assert.equal(await verifySignature(header(now - 301), body, secret, now), false);
    assert.equal(await verifySignature(header(now + 301), body, secret, now), false);
  });

  it("honours a tolerance it is given", async () => {
    assert.equal(await verifySignature(header(now - 20), body, secret, now, 10), false);
    assert.equal(await verifySignature(header(now - 20), body, secret, now, 30), true);
  });

  it("refuses a missing, empty or malformed header", async () => {
    assert.equal(await verifySignature(null, body, secret, now), false);
    assert.equal(await verifySignature("", body, secret, now), false);
    assert.equal(await verifySignature("t=1800000000", body, secret, now), false);
    assert.equal(await verifySignature(`v1=${mac(now)}`, body, secret, now), false);
    assert.equal(await verifySignature(`t=abc,v1=${mac(now)}`, body, secret, now), false);
  });
});
