/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
// Covers the one call the Edge Functions make to RevenueCat's REST API, with
// fetch faked. The module has no imports so Deno and this runner can both
// load it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeSubscriberFetcher } from "@/supabase/functions/_shared/revenuecat-client";

type Seen = { url: string; init: RequestInit | undefined };

function fakeFetch(respond: () => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return respond();
  }) as typeof fetch;
  return { impl, seen };
}
const answer = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("makeSubscriberFetcher", () => {
  const subscriber = { entitlements: {}, subscriptions: {} };

  it("asks for the customer with the secret key and returns the subscriber", async () => {
    const { impl, seen } = fakeFetch(() => answer({ subscriber }));
    const got = await makeSubscriberFetcher("sk_test", impl)("11111111-1111-4111-8111-111111111111");
    assert.deepEqual(got, subscriber);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "https://api.revenuecat.com/v1/subscribers/11111111-1111-4111-8111-111111111111");
    const headers = new Headers(seen[0].init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer sk_test");
    assert.ok(seen[0].init?.signal instanceof AbortSignal, "the call has a timeout");
  });

  it("encodes the id into the path", async () => {
    const { impl, seen } = fakeFetch(() => answer({ subscriber }));
    await makeSubscriberFetcher("sk_test", impl)("a b/c");
    assert.equal(seen[0].url, "https://api.revenuecat.com/v1/subscribers/a%20b%2Fc");
  });

  it("accepts 201, which RevenueCat answers for a customer it just created", async () => {
    const { impl } = fakeFetch(() => answer({ subscriber }, 201));
    assert.deepEqual(await makeSubscriberFetcher("sk_test", impl)("u"), subscriber);
  });

  it("throws on an answer that is not 2xx, naming the status", async () => {
    for (const status of [401, 404, 429, 500]) {
      const { impl } = fakeFetch(() => answer({ message: "no" }, status));
      await assert.rejects(() => makeSubscriberFetcher("sk_test", impl)("u"), new RegExp(`RevenueCat answered ${status}`));
    }
  });

  it("throws, rather than reporting an empty customer, when the answer has no subscriber", async () => {
    for (const body of [{}, { subscriber: null }, { subscriber: "x" }, []]) {
      const { impl } = fakeFetch(() => answer(body));
      await assert.rejects(() => makeSubscriberFetcher("sk_test", impl)("u"), /no subscriber/, JSON.stringify(body));
    }
  });

  it("throws when the answer is not JSON", async () => {
    const { impl } = fakeFetch(() => answer("<html>bad gateway</html>"));
    await assert.rejects(() => makeSubscriberFetcher("sk_test", impl)("u"), /not JSON/);
  });

  it("lets a network failure through", async () => {
    const impl = (async () => {
      throw new Error("connection reset");
    }) as typeof fetch;
    await assert.rejects(() => makeSubscriberFetcher("sk_test", impl)("u"), /connection reset/);
  });
});
