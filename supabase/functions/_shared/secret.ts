// Shared-secret helpers for the Edge Functions that are called with a secret
// instead of a Supabase token: estimate-meal (the database, header
// x-estimate-secret) and revenuecat-webhook (RevenueCat, header Authorization
// and, optionally, a signature). No imports, so Deno and `npm test` both load
// it (src/utils/secret.test.ts).

/** Compares two secrets in time that doesn't depend on where they differ. */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * RevenueCat's webhook signature (header X-RevenueCat-Webhook-Signature):
 * `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`, keyed with the
 * secret shown once in its dashboard. Refused when it is missing, malformed,
 * wrong, or older or newer than `toleranceSeconds` (a replay).
 */
export async function verifySignature(
  header: string | null,
  rawBody: string,
  secret: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!header) return false;
  const parts = new Map<string, string>();
  for (const piece of header.split(',')) {
    const eq = piece.indexOf('=');
    if (eq > 0) parts.set(piece.slice(0, eq).trim(), piece.slice(eq + 1).trim());
  }
  const t = parts.get('t');
  const v1 = parts.get('v1');
  if (!t || !v1 || !/^\d+$/.test(t)) return false;
  if (Math.abs(nowSeconds - Number(t)) > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`)));
  return sameSecret(mac, v1.toLowerCase());
}
