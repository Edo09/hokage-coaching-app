// Provider calls shared by generate-program and ai-complete: which models,
// which endpoints, and what to do when one fails live here, so a provider
// change is one edit. The keys are function secrets — never in a URL, a
// browser or an app bundle:
//
//   supabase secrets set GEMINI_API_KEY=... GROQ_API_KEY=... --project-ref rzgwkwxskrovxnnymxqo
//
// GEMINI_MODEL (optional secret) overrides the first Gemini model tried.

/**
 * Tried in order. A model moves on to the next when it's overloaded (503,
 * after one retry), out of quota (429) or not available to the key (404) —
 * Google limits gemini-2.5-flash to projects that already used it, so it's
 * last.
 */
const GEMINI_MODELS = [
  ...new Set([Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash']),
];
// Standard Gemini API keys (AIza...) use generativelanguage.googleapis.com;
// Vertex AI express-mode keys use aiplatform.googleapis.com.
const GEMINI_BASES = [
  'https://generativelanguage.googleapis.com/v1beta/models',
  'https://aiplatform.googleapis.com/v1/publishers/google/models',
];
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** Groq text models, tried in order when one isn't available to the key
 *  (Llama 3.3 70B became enterprise-only), rate-limited or down. */
export const GROQ_TEXT_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
export const GROQ_VISION_MODELS = ['qwen/qwen3.8-27b'];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const snippet = async (res: Response) => (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);

export interface GeminiRequest {
  system: string;
  /** User content parts: text, and optionally inline_data for an image. */
  parts: Record<string, unknown>[];
  /** responseSchema (OpenAPI subset). Omit for plain JSON mode. */
  schema?: Record<string, unknown>;
  temperature: number;
  /** Thinking counts toward this on thinking models. */
  maxOutputTokens: number;
  thinking: 'low' | 'medium' | 'high';
  /** For the whole call, all models and retries included. */
  timeoutMs: number;
}

/** Gemini's JSON reply as text. Throws with each model's error when none answered. */
export async function callGemini(r: GeminiRequest): Promise<string> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const signal = AbortSignal.timeout(r.timeoutMs);
  const post = (url: string, full: boolean) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: r.system }] },
        contents: [{ role: 'user', parts: r.parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: r.temperature,
          maxOutputTokens: r.maxOutputTokens,
          ...(full
            ? { ...(r.schema ? { responseSchema: r.schema } : {}), thinkingConfig: { thinkingLevel: r.thinking } }
            : {}),
        },
      }),
      signal,
    });

  const errors: string[] = [];
  for (const model of GEMINI_MODELS) {
    for (const base of GEMINI_BASES) {
      const url = `${base}/${model}:generateContent`;
      let full = true;
      let res = await post(url, full);
      // 400 = the request itself was refused (a schema too complex to serve,
      // a config field this model doesn't take): retry once as plain JSON mode.
      if (res.status === 400) {
        console.warn(`Gemini ${model} 400: ${await snippet(res)} — retrying without schema/thinking config`);
        full = false;
        res = await post(url, full);
      }
      // Overloaded ("high demand") is usually a blip: one retry, then move on.
      if (res.status === 503 || res.status === 500) {
        console.warn(`Gemini ${model} ${res.status}: ${await snippet(res)} — retrying in 2 s`);
        await sleep(2000);
        res = await post(url, full);
      }
      if (res.ok) {
        const data = await res.json();
        const candidate = data?.candidates?.[0];
        if (candidate?.finishReason === 'MAX_TOKENS') throw new Error(`Gemini ${model}: response truncated (MAX_TOKENS)`);
        const text = candidate?.content?.parts?.find((p: { text?: string; thought?: boolean }) => !p.thought && p.text)?.text;
        if (typeof text !== 'string') throw new Error(`Gemini ${model}: empty response (${candidate?.finishReason ?? 'no candidate'})`);
        return text;
      }
      errors.push(`${model} ${res.status}: ${await snippet(res)}`);
      // 400/401/403: wrong key type for this endpoint — try the other one.
      // 404 (not available to this key), 429 (quota), 5xx: next model.
      if (res.status === 400 || res.status === 401 || res.status === 403) continue;
      break;
    }
  }
  throw new Error(`Gemini — ${errors.join('; ')}`);
}

export interface GroqRequest {
  models: string[];
  system: string;
  /** Text, or content parts (text + image_url) for a vision model. */
  user: string | Record<string, unknown>[];
  temperature: number;
  /** Reasoning tokens count toward this on reasoning models. */
  maxTokens: number;
  /** gpt-oss: 'low' | 'medium' | 'high'; qwen3: 'none' | 'default'. */
  reasoningEffort?: string;
  timeoutMs: number;
}

/** Groq's JSON reply as text, from the first model the key can use. */
export async function callGroq(r: GroqRequest): Promise<string> {
  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');

  const signal = AbortSignal.timeout(r.timeoutMs);
  const errors: string[] = [];
  for (const model of r.models) {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        temperature: r.temperature,
        max_completion_tokens: r.maxTokens,
        ...(r.reasoningEffort ? { reasoning_effort: r.reasoningEffort } : {}),
        messages: [
          { role: 'system', content: r.system },
          { role: 'user', content: r.user },
        ],
      }),
      signal,
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.choices?.[0]?.finish_reason === 'length') throw new Error(`Groq ${model}: response truncated (length)`);
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error(`Groq ${model}: empty response`);
      return content;
    }
    errors.push(`${model} ${res.status}: ${await snippet(res)}`);
    // 404 (retired or not on this key's plan), 429 (this model's rate limit —
    // Groq counts each model separately), 5xx: try the next one. 400/401/403
    // would fail the same way on every model.
    if (res.status === 404 || res.status === 429 || res.status >= 500) continue;
    break;
  }
  throw new Error(`Groq — ${errors.join('; ')}`);
}

/** JSON mode without a schema sometimes still wraps the object in a fence. */
export function parseJson(text: string): unknown {
  const t = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return JSON.parse(fenced ? fenced[1] : t);
}

/** One provider failure as a line for logs and the caller's `detail`. */
export function errorText(provider: string, e: unknown): string {
  if (e instanceof Error) return `${provider}: ${e.name === 'TimeoutError' ? 'timeout — ' : ''}${e.message}`;
  return `${provider}: ${String(e)}`;
}
