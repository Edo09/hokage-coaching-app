// Model calls that may carry a photo, shared by ai-complete (the app's weekly
// analysis) and estimate-meal (the estimate of a registered meal). Models,
// endpoints, key handling and retries: ./llm.ts.
//
// Order:
//   - text:  Groq first, Gemini on any failure.
//   - image: Gemini first, Groq vision on any failure. The app's Groq vision
//            model (llama-4-scout) was shut down on 2026-07-17, so Gemini
//            answers every photo; its replacement is the fallback.
// Either key alone works.

import type { Provider } from './complete-json.ts';
import { callGemini, callGroq, errorText, GROQ_TEXT_MODELS, GROQ_VISION_MODELS, parseJson } from './llm.ts';

/** Answers are a few fields of JSON; this only bounds a runaway reply. */
const MAX_OUTPUT_TOKENS = 1024;
/** Thinking/reasoning models spend part of their output limit before the
 *  answer — the answer itself is still bounded by the prompt's shape. */
const REASONING_MAX_OUTPUT_TOKENS = 4096;
const TEXT_TIMEOUT_MS = 20_000;
const IMAGE_TIMEOUT_MS = 30_000;

// ~5 MB decoded. The app's photos (quality 0.5) are typically 1–3 MB of
// base64; Gemini takes up to 20 MB per request.
export const MAX_IMAGE_BASE64_CHARS = 7_000_000;
export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export type PhotoInput = { base64: string; mimeType: string };

export interface PhotoJsonRequest {
  system: string;
  user: string;
  image?: PhotoInput;
  /** Replaces every provider's default temperature when given. */
  temperature?: number;
}

function gemini(r: PhotoJsonRequest, timeoutMs: number): Promise<string> {
  const parts: Record<string, unknown>[] = [{ text: r.user }];
  if (r.image) parts.push({ inline_data: { mime_type: r.image.mimeType, data: r.image.base64 } });
  return callGemini({
    system: r.system,
    parts,
    temperature: r.temperature ?? (r.image ? 0.4 : 0.7),
    maxOutputTokens: REASONING_MAX_OUTPUT_TOKENS,
    // Short lookups: as little thinking as the model allows.
    thinking: 'low',
    timeoutMs,
  });
}

function groq(r: PhotoJsonRequest, timeoutMs: number): Promise<string> {
  if (r.image) {
    return callGroq({
      models: GROQ_VISION_MODELS,
      system: r.system,
      user: [
        { type: 'text', text: r.user },
        { type: 'image_url', image_url: { url: `data:${r.image.mimeType};base64,${r.image.base64}` } },
      ],
      temperature: r.temperature ?? 0.4,
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
    temperature: r.temperature ?? 0.7,
    maxTokens: REASONING_MAX_OUTPUT_TOKENS,
    reasoningEffort: 'low',
    timeoutMs,
  });
}

/** Tries the providers in the order above. Returns the parsed JSON and which
 *  provider answered; a reply that isn't JSON counts as that provider failing. */
export async function completeJSONWithPhoto(r: PhotoJsonRequest): Promise<{ json: unknown; provider: Provider }> {
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
