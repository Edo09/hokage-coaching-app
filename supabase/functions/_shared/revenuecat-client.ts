// The one call the Edge Functions make to RevenueCat's REST API: the customer
// of an app user id. fetch is passed in so src/utils/revenuecat-client.test.ts
// can fake it. No imports, so Deno and `npm test` both load it.
//
// GET /v1/subscribers/{app_user_id} creates the customer if RevenueCat has
// none (it answers 201), so callers only ask about ids that are real profiles.
// The key is the project's SECRET API key (REVENUECAT_API_KEY): it must never
// leave the server.

const API = 'https://api.revenuecat.com/v1';

export function makeSubscriberFetcher(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000,
): (appUserId: string) => Promise<unknown> {
  return async (appUserId) => {
    const res = await fetchImpl(`${API}/subscribers/${encodeURIComponent(appUserId)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`RevenueCat answered ${res.status}`);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new Error('RevenueCat answered with something that is not JSON');
    }
    const subscriber = typeof body === 'object' && body !== null ? (body as { subscriber?: unknown }).subscriber : undefined;
    // An answer without a customer is an error to retry, never «no access»:
    // storing it would revoke somebody's subscription over a malformed reply.
    if (typeof subscriber !== 'object' || subscriber === null) {
      throw new Error('RevenueCat answered with no subscriber');
    }
    return subscriber;
  };
}
