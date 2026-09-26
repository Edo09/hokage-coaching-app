// LLM access for generate-program: Gemini first (JSON constrained by a
// response schema), Groq on any Gemini failure (JSON mode, shape given in the
// prompt). Models, endpoints and retries: ../_shared/llm.ts. Either key alone
// works; with both, Groq is only the fallback.

import { callGemini, callGroq, errorText, GROQ_TEXT_MODELS, parseJson } from '../_shared/llm.ts';

// Groq's free plan has a small tokens-per-minute budget, and a single request
// over it is refused outright. A program is ~3–6k tokens.
const GROQ_MAX_OUTPUT = 8000;

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

/** Gemini, then Groq. Returns the parsed JSON and which provider answered.
 *  `groqTimeoutMs` lets the caller keep the fallback inside the function's
 *  wall-clock limit. Throws with every provider's error joined by " | ". */
export async function completeJSON(
  r: JsonRequest,
  groqTimeoutMs = r.timeoutMs,
): Promise<{ json: unknown; provider: Provider }> {
  const attempts: [Provider, () => Promise<string>][] = [
    [
      'gemini',
      () =>
        callGemini({
          system: r.system,
          parts: [{ text: r.user }],
          schema: r.schema,
          temperature: 0.4,
          maxOutputTokens: r.maxOutputTokens,
          thinking: r.thinking ?? 'low',
          timeoutMs: r.timeoutMs,
        }),
    ],
    [
      'groq',
      () =>
        callGroq({
          models: GROQ_TEXT_MODELS,
          system: r.system,
          user: r.user,
          temperature: 0.4,
          maxTokens: Math.min(r.maxOutputTokens, GROQ_MAX_OUTPUT),
          reasoningEffort: 'low',
          timeoutMs: groqTimeoutMs,
        }),
    ],
  ];
  const errors: string[] = [];
  for (const [provider, call] of attempts) {
    try {
      return { json: parseJson(await call()), provider };
    } catch (e) {
      console.warn(`${provider} failed:`, e);
      errors.push(errorText(provider, e));
    }
  }
  throw new Error(errors.join(' | '));
}
