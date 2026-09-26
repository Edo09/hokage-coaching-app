// Server-side LLM access for generate-program: Gemini first (JSON constrained
// by a response schema), Groq on any Gemini failure (JSON mode, shape given in
// the prompt). Same providers as the app's src/services/llm.ts, but the keys
// are function secrets — they never reach a browser or an app bundle:
//
//   supabase secrets set GEMINI_API_KEY=... GROQ_API_KEY=... --project-ref rzgwkwxskrovxnnymxqo
//
// Either key alone works; with both, Groq is only the fallback.

const GEMINI_MODEL = 'gemini-2.5-flash';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

export type Provider = 'gemini' | 'groq';

export interface JsonRequest {
  system: string;
  user: string;
  /** Gemini responseSchema. Groq relies on the shape described in `system`. */
  schema: Record<string, unknown>;
  /** Budget for the whole call, per provider. */
  timeoutMs: number;
  maxOutputTokens: number;
  /** Gemini thinking tokens. Some thinking helps it keep the limits and the
   *  edit-mode refs; an unbounded budget makes a big program take too long.
   *  0 turns it off (simple lookups). */
  thinkingBudget?: number;
}

async function callGemini(r: JsonRequest): Promise<string> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const body = (withSchema: boolean) =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: r.system }] },
      contents: [{ role: 'user', parts: [{ text: r.user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        ...(withSchema ? { responseSchema: r.schema } : {}),
        temperature: 0.4,
        maxOutputTokens: r.maxOutputTokens,
        thinkingConfig: { thinkingBudget: r.thinkingBudget ?? 2048 },
      },
    });

  // Standard Gemini API keys (AIza...) use generativelanguage.googleapis.com;
  // Vertex AI express-mode keys use aiplatform.googleapis.com. Try both. The
  // key goes in a header, not the URL, so it never lands in a request log.
  const endpoints = [
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    `https://aiplatform.googleapis.com/v1/publishers/google/models/${GEMINI_MODEL}:generateContent`,
  ];
  const signal = AbortSignal.timeout(r.timeoutMs);

  let lastError = '';
  for (const url of endpoints) {
    let withSchema = true;
    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: body(withSchema),
      signal,
    });
    // A schema too complex for the serving constraint is a 400: retry once
    // with JSON mode only — the shape is also spelled out in the prompt.
    if (res.status === 400) {
      const text = await res.text().catch(() => '');
      lastError = `Gemini 400: ${text.slice(0, 300)}`;
      if (!/schema|states/i.test(text)) continue;
      withSchema = false;
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: body(withSchema),
        signal,
      });
    }
    if (!res.ok) {
      lastError = `Gemini ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`;
      if (res.status === 401 || res.status === 403 || res.status === 400) continue;
      throw new Error(lastError);
    }
    const data = await res.json();
    const candidate = data?.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('Gemini response truncated (MAX_TOKENS)');
    const text = candidate?.content?.parts?.find((p: { text?: string; thought?: boolean }) => !p.thought && p.text)?.text;
    if (typeof text !== 'string') throw new Error(`Empty Gemini response (${candidate?.finishReason ?? 'no candidate'})`);
    return text;
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
      max_tokens: Math.min(r.maxOutputTokens, 32768),
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

/** Gemini, then Groq. Returns the parsed JSON and which provider answered.
 *  `groqTimeoutMs` lets the caller keep the fallback inside the function's
 *  wall-clock limit. */
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
      return { json: JSON.parse(text), provider };
    } catch (e) {
      console.warn(`${provider} failed:`, e);
      errors.push(`${provider}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(errors.join(' | '));
}
