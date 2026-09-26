// Server-side LLM access for ai-complete: the prompt pairs the mobile app
// used to send to Groq and Gemini itself (src/services/llm.ts). Same keys
// and key handling as ../generate-program/llm.ts — function secrets, the
// Gemini key in a header, never in a URL or the app bundle:
//
//   supabase secrets set GEMINI_API_KEY=... GROQ_API_KEY=... --project-ref rzgwkwxskrovxnnymxqo
//
// Order:
//   - text:  Groq (Llama 3.3 70B) first, Gemini on any failure — as the app did.
//   - image: Gemini first, Groq vision on any failure. The app's Groq vision
//            model (llama-4-scout) was shut down on 2026-07-17, so Gemini was
//            already answering every photo; its replacement is the fallback.
// Either key alone works. GEMINI_MODEL (optional secret) overrides the first
// Gemini model tried.

// Google limits gemini-2.5-flash to projects that already used it; a key
// from a new project gets an error, so a current model goes first and 2.5 is
// only tried when that one isn't available to the key.
const GEMINI_MODELS = [...new Set([Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash', 'gemini-2.5-flash'])];
// Standard Gemini API keys (AIza...) use generativelanguage.googleapis.com;
// Vertex AI express-mode keys use aiplatform.googleapis.com.
const GEMINI_BASES = [
  'https://generativelanguage.googleapis.com/v1beta/models',
  'https://aiplatform.googleapis.com/v1/publishers/google/models',
];
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_VISION_MODEL = 'qwen/qwen3.8-27b';

/** Answers are a few fields of JSON; this only bounds a runaway reply. */
const MAX_OUTPUT_TOKENS = 1024;
/** Gemini 3 always thinks a little, and thinking counts toward its output
 *  limit — the answer itself is still bounded by the prompt's shape. */
const GEMINI_MAX_OUTPUT_TOKENS = 4096;
const TEXT_TIMEOUT_MS = 20_000;
const IMAGE_TIMEOUT_MS = 30_000;

export type Provider = 'gemini' | 'groq';
export type ImageInput = { base64: string; mimeType: string };

export interface CompleteRequest {
  system: string;
  user: string;
  image?: ImageInput;
}

async function callGemini(r: CompleteRequest, timeoutMs: number): Promise<string> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const parts: Record<string, unknown>[] = [{ text: r.user }];
  if (r.image) parts.push({ inline_data: { mime_type: r.image.mimeType, data: r.image.base64 } });

  const signal = AbortSignal.timeout(timeoutMs);
  const post = (url: string, full: boolean) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: r.system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: r.image ? 0.4 : 0.7,
          maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
          // Short lookups: as little thinking as the model allows.
          ...(full ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
        },
      }),
      signal,
    });

  let lastError = '';
  for (const model of GEMINI_MODELS) {
    for (const base of GEMINI_BASES) {
      const url = `${base}/${model}:generateContent`;
      let res = await post(url, true);
      // 400 = the request itself was refused (e.g. a config field this model
      // doesn't take): retry once without the thinking config.
      if (res.status === 400) {
        lastError = `Gemini ${model} 400: ${(await res.text().catch(() => '')).slice(0, 300)}`;
        console.warn(lastError, '— retrying without thinking config');
        res = await post(url, false);
      }
      if (res.ok) {
        const data = await res.json();
        const candidate = data?.candidates?.[0];
        if (candidate?.finishReason === 'MAX_TOKENS') throw new Error(`Gemini ${model} response truncated (MAX_TOKENS)`);
        const text = candidate?.content?.parts?.find((p: { text?: string; thought?: boolean }) => !p.thought && p.text)?.text;
        if (typeof text !== 'string') throw new Error(`Empty Gemini ${model} response (${candidate?.finishReason ?? 'no candidate'})`);
        return text;
      }
      lastError = `Gemini ${model} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`;
      // 400/401/403: wrong key type for this endpoint (or model not allowed
      // for it) — try the other endpoint. 404: model unavailable — next model.
      // Anything else (429 quota, 5xx): Gemini is out for this request.
      if (res.status === 400 || res.status === 401 || res.status === 403) continue;
      if (res.status === 404) break;
      throw new Error(lastError);
    }
  }
  throw new Error(lastError || 'Gemini call failed');
}

async function callGroq(r: CompleteRequest, timeoutMs: number): Promise<string> {
  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');

  const user = r.image
    ? [
        { type: 'text', text: r.user },
        { type: 'image_url', image_url: { url: `data:${r.image.mimeType};base64,${r.image.base64}` } },
      ]
    : r.user;

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: r.image ? GROQ_VISION_MODEL : GROQ_MODEL,
      response_format: { type: 'json_object' },
      temperature: r.image ? 0.4 : 0.7,
      max_tokens: MAX_OUTPUT_TOKENS,
      // The vision model reasons by default; off, as with Gemini above.
      ...(r.image ? { reasoning_effort: 'none' } : {}),
      messages: [
        { role: 'system', content: r.system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Groq ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  }
  const data = await res.json();
  if (data?.choices?.[0]?.finish_reason === 'length') throw new Error('Groq response truncated (length)');
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Empty Groq response');
  return content;
}

/** Tries the providers in the order above. Returns the parsed JSON and which
 *  provider answered; a reply that isn't JSON counts as that provider failing. */
export async function completeJSON(r: CompleteRequest): Promise<{ json: unknown; provider: Provider }> {
  const timeoutMs = r.image ? IMAGE_TIMEOUT_MS : TEXT_TIMEOUT_MS;
  const gemini: [Provider, () => Promise<string>] = ['gemini', () => callGemini(r, timeoutMs)];
  const groq: [Provider, () => Promise<string>] = ['groq', () => callGroq(r, timeoutMs)];
  const attempts = r.image ? [gemini, groq] : [groq, gemini];

  const errors: string[] = [];
  for (const [provider, call] of attempts) {
    try {
      const text = await call();
      return { json: JSON.parse(text), provider };
    } catch (e) {
      console.warn(`${provider} failed:`, e);
      errors.push(`${provider}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(errors.join(' | '));
}
