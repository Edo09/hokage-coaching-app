// LLM access for ai-complete: the prompt pairs the mobile app used to send to
// Groq and Gemini itself (src/services/llm.ts). Models, endpoints, key
// handling and retries: ../_shared/llm.ts.
//
// Order:
//   - text:  Groq first, Gemini on any failure — as the app did.
//   - image: Gemini first, Groq vision on any failure. The app's Groq vision
//            model (llama-4-scout) was shut down on 2026-07-17, so Gemini was
//            already answering every photo; its replacement is the fallback.
// Either key alone works.

import { callGemini, callGroq, errorText, GROQ_TEXT_MODELS, GROQ_VISION_MODELS, parseJson } from '../_shared/llm.ts';

/** Answers are a few fields of JSON; this only bounds a runaway reply. */
const MAX_OUTPUT_TOKENS = 1024;
/** Thinking/reasoning models spend part of their output limit before the
 *  answer — the answer itself is still bounded by the prompt's shape. */
const REASONING_MAX_OUTPUT_TOKENS = 4096;
const TEXT_TIMEOUT_MS = 20_000;
const IMAGE_TIMEOUT_MS = 30_000;

export type Provider = 'gemini' | 'groq';
export type ImageInput = { base64: string; mimeType: string };

export interface CompleteRequest {
  system: string;
  user: string;
  image?: ImageInput;
}

function gemini(r: CompleteRequest, timeoutMs: number): Promise<string> {
  const parts: Record<string, unknown>[] = [{ text: r.user }];
  if (r.image) parts.push({ inline_data: { mime_type: r.image.mimeType, data: r.image.base64 } });
  return callGemini({
    system: r.system,
    parts,
    temperature: r.image ? 0.4 : 0.7,
    maxOutputTokens: REASONING_MAX_OUTPUT_TOKENS,
    // Short lookups: as little thinking as the model allows.
    thinking: 'low',
    timeoutMs,
  });
}

function groq(r: CompleteRequest, timeoutMs: number): Promise<string> {
  if (r.image) {
    return callGroq({
      models: GROQ_VISION_MODELS,
      system: r.system,
      user: [
        { type: 'text', text: r.user },
        { type: 'image_url', image_url: { url: `data:${r.image.mimeType};base64,${r.image.base64}` } },
      ],
      temperature: 0.4,
      maxTokens: MAX_OUTPUT_TOKENS,
      // The vision model reasons by default; off, as the lookup is short.
      reasoningEffort: 'none',
      timeoutMs,
    });
  }
  return callGroq({
    models: GROQ_TEXT_MODELS,
    system: r.system,
    user: r.user,
    temperature: 0.7,
    maxTokens: REASONING_MAX_OUTPUT_TOKENS,
    reasoningEffort: 'low',
    timeoutMs,
  });
}

/** Tries the providers in the order above. Returns the parsed JSON and which
 *  provider answered; a reply that isn't JSON counts as that provider failing. */
export async function completeJSON(r: CompleteRequest): Promise<{ json: unknown; provider: Provider }> {
  const timeoutMs = r.image ? IMAGE_TIMEOUT_MS : TEXT_TIMEOUT_MS;
  const g: [Provider, () => Promise<string>] = ['gemini', () => gemini(r, timeoutMs)];
  const q: [Provider, () => Promise<string>] = ['groq', () => groq(r, timeoutMs)];
  const attempts = r.image ? [g, q] : [q, g];

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
