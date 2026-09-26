// Mobile app AI — meal estimates from a name or a photo, and the weekly
// progress insight. The app builds the prompt; this function calls the model
// with the server-side keys (see llm.ts) so they never ship in the app
// bundle, and returns the parsed JSON:
//
//   { system, user, image?: { base64, mimeType } } → { result, provider }
//
// Callers are the clients, so any signed-in user may call it (not only the
// coach), within a per-user quota: take_ai_quota() in migration
// 20260926140000_ai_request_quota.sql, 30 requests/hour and 100/day. Native
// app requests carry no Origin, so ../_shared/cors.ts lets them through.
//
// Apply that migration first (without it every request gets 503), then
// deploy and give it the provider keys (see llm.ts):
//   supabase functions deploy ai-complete --project-ref rzgwkwxskrovxnnymxqo

import { callerClient } from '../_shared/coach.ts';
import { json, withCors } from '../_shared/cors.ts';
import { completeJSON, type ImageInput } from './llm.ts';

// The app's prompts are ~2 KB each; the caps only bound what one request
// can spend.
const MAX_SYSTEM_CHARS = 6000;
const MAX_USER_CHARS = 6000;
// ~5 MB decoded. The app's photos (quality 0.5) are typically 1–3 MB of
// base64; Gemini takes up to 20 MB per request.
const MAX_IMAGE_BASE64_CHARS = 7_000_000;
const MAX_BODY_BYTES = MAX_IMAGE_BASE64_CHARS + MAX_SYSTEM_CHARS + MAX_USER_CHARS + 16_384;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

Deno.serve(withCors(async (req) => {
  try {
    if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) {
      return json({ error: 'request too large' }, 413);
    }

    const db = callerClient(req);
    const { data: { user } } = await db.auth.getUser();
    if (!user) return json({ error: 'unauthenticated' }, 401);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'invalid request' }, 400);
    }
    if (!isObj(body)) return json({ error: 'invalid request' }, 400);

    const system = typeof body.system === 'string' ? body.system.trim() : '';
    const prompt = typeof body.user === 'string' ? body.user.trim() : '';
    if (!system || !prompt) return json({ error: 'invalid request' }, 400);
    if (system.length > MAX_SYSTEM_CHARS || prompt.length > MAX_USER_CHARS) {
      return json({ error: 'prompt too long' }, 413);
    }

    let image: ImageInput | undefined;
    if (body.image != null) {
      if (!isObj(body.image) || typeof body.image.base64 !== 'string' || typeof body.image.mimeType !== 'string') {
        return json({ error: 'invalid image' }, 400);
      }
      const base64 = body.image.base64.replace(/\s+/g, '');
      const mimeType = body.image.mimeType.toLowerCase() === 'image/jpg' ? 'image/jpeg' : body.image.mimeType.toLowerCase();
      if (base64.length > MAX_IMAGE_BASE64_CHARS) return json({ error: 'image too large' }, 413);
      if (!BASE64.test(base64) || !IMAGE_TYPES.has(mimeType)) return json({ error: 'invalid image' }, 400);
      image = { base64, mimeType };
    }

    // After validation, so a malformed request doesn't use up quota.
    const { data: allowed, error: quotaError } = await db.rpc('take_ai_quota');
    if (quotaError) {
      console.error('take_ai_quota failed (migration applied?):', quotaError);
      return json({ error: 'AI is unavailable' }, 503);
    }
    if (allowed !== true) return json({ error: 'rate limited' }, 429);

    const { json: result, provider } = await completeJSON({ system, user: prompt, image });
    return json({ result, provider }, 200);
  } catch (e) {
    console.error('ai-complete failed:', e);
    return json({ error: 'AI request failed' }, 502);
  }
}));
