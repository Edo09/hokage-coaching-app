// Server-side LLM access for generate-program: Gemini first (JSON constrained
// by a response schema), Groq on any Gemini failure (JSON mode, shape given in
// the prompt). The keys are function secrets — they never reach a browser or
// an app bundle:
//
//   supabase secrets set GEMINI_API_KEY=... GROQ_API_KEY=... --project-ref rzgwkwxskrovxnnymxqo
//
// Either key alone works; with both, Groq is only the fallback. GEMINI_MODEL
// (optional secret) overrides the first Gemini model tried.

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
// Groq's free plan has a small tokens-per-minute budget for this model, and a
// single request over it is refused outright. A program is ~3–6k tokens.
const GROQ_MAX_OUTPUT = 7000;

export type Provider = 'gemini' | 'groq';

export interface JsonRequest {
  system: string;
  user: string;
  /** Gemini responseSchema. Groq relies on the shape described in `system`. */
  schema: Record<string, unknown>;
  /** Budget for the whole call, per provider. */
  timeoutMs: number;
  maxOutputTokens: number;
  /** Gemini thinkingLevel. Some thinking helps it keep the limits and the
   *  edit-mode refs; more makes a big program take too long. */
  thinking?: 'low' | 'medium' | 'high';
}

async function callGemini(r: JsonRequest): Promise<string> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const signal = AbortSignal.timeout(r.timeoutMs);
  const post = (url: string, full: boolean) =>
    fetch(url, {
      method: 'POST',
      // The key goes in a header, not the URL, so it never lands in a log.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: r.system }] },
        contents: [{ role: 'user', parts: [{ text: r.user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.4,
          maxOutputTokens: r.maxOutputTokens,
          ...(full ? { responseSchema: r.schema, thinkingConfig: { thinkingLevel: r.thinking ?? 'low' } } : {}),
        },
      }),
      signal,
    });

  let lastError = '';
  for (const model of GEMINI_MODELS) {
    for (const base of GEMINI_BASES) {
      const url = `${base}/${model}:generateContent`;
      let res = await post(url, true);
      // 400 = the request itself was refused (a schema too complex to serve,
      // a config field this model doesn't take). Retry once with plain JSON
      // mode — the shape is also spelled out in the prompt.
      if (res.status === 400) {
        lastError = `Gemini ${model} 400: ${(await res.text().catch(() => '')).slice(0, 300)}`;
        console.warn(lastError, '— retrying without schema/thinking config');
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

async function callGroq(r: JsonRequest): Promise<string> {
  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_completion_tokens: Math.min(r.maxOutputTokens, GROQ_MAX_OUTPUT),
      messages: [
        { role: 'system', content: r.system },
        { role: 'user', content: r.user },
      ],
    }),
    signal: AbortSignal.timeout(r.timeoutMs),
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

/** JSON mode without a schema sometimes still wraps the object in a fence. */
function parseJson(text: string): unknown {
  const t = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return JSON.parse(fenced ? fenced[1] : t);
}

/** Gemini, then Groq. Returns the parsed JSON and which provider answered.
 *  `groqTimeoutMs` lets the caller keep the fallback inside the function's
 *  wall-clock limit. Throws with every provider's error joined by " | ". */
export async function completeJSON(
  r: JsonRequest,
  groqTimeoutMs = r.timeoutMs,
): Promise<{ json: unknown; provider: Provider }> {
  const attempts: [Provider, () => Promise<string>][] = [
    ['gemini', () => callGemini(r)],
    ['groq', () => callGroq({ ...r, timeoutMs: groqTimeoutMs })],
  ];
  const errors: string[] = [];
  for (const [provider, call] of attempts) {
    try {
      const text = await call();
      return { json: parseJson(text), provider };
    } catch (e) {
      console.warn(`${provider} failed:`, e);
      errors.push(`${provider}: ${e instanceof Error ? `${e.name === 'TimeoutError' ? 'timeout — ' : ''}${e.message}` : String(e)}`);
    }
  }
  throw new Error(errors.join(' | '));
}
