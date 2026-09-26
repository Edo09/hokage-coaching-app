// CORS for the coach-panel Edge Functions. Only the origins listed in the
// ALLOWED_ORIGINS function secret may call them from a browser:
//
//   supabase secrets set ALLOWED_ORIGINS=https://panel.example.com,http://localhost:5173
//
// Comma-separated, exact origins (scheme + host [+ port]), no trailing slash.
// Unset means no browser origin is allowed, so the panel cannot call the
// functions until it is set.

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  console.error('ALLOWED_ORIGINS is not set: every browser request to this function is refused.');
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    // supabase-js invoke() sends apikey + x-client-info too — omitting them
    // from the preflight allowlist makes the browser block the POST entirely.
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (origin && allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

/** Wraps a POST handler with the CORS rules above. A request from a browser
 *  origin that isn't allowed is refused before the handler runs; requests
 *  with no Origin (not a browser) pass through to the handler's own auth. */
export function withCors(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('Origin');
    const cors = corsHeaders(origin);
    if (origin && !cors['Access-Control-Allow-Origin']) {
      return new Response(JSON.stringify({ error: 'origin not allowed' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

    const res = req.method === 'POST' ? await handler(req) : json({ error: 'method not allowed' }, 405);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
