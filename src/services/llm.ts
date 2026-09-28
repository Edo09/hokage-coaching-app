import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";

import { supabase } from "@/src/utils/supabase";

// Shared LLM access through the ai-complete Edge Function
// (supabase/functions/ai-complete). The function holds the Groq/Gemini keys
// as secrets — they are not in the app bundle — checks the caller is signed
// in, applies a per-user quota, and returns the model's JSON already parsed.

export type ImageInput = { base64: string; mimeType: string };

/** Why an AI call failed, so screens can say what happened (and skip a
 *  retry that would fail the same way). */
export type AiErrorKind =
  | "too_large" // 413: the photo (or prompt) is over the function's cap
  | "rate_limited" // 429: the user's hourly/daily quota is spent
  | "unavailable" // 503/404: quota migration missing or function not deployed
  | "offline" // the request never reached the function
  | "no_food" // the photo isn't food (ai-nutrition)
  | "failed"; // anything else: the model call failed, bad output, auth

export class AiError extends Error {
  readonly kind: AiErrorKind;

  constructor(kind: AiErrorKind, message: string) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
  }
}

export const aiErrorKind = (e: unknown): AiErrorKind =>
  e instanceof AiError ? e.kind : "failed";

/** False when another attempt right away would fail the same way. */
export const isAiRetryable = (e: unknown): boolean => {
  const kind = aiErrorKind(e);
  return kind === "failed" || kind === "offline";
};

const KIND_BY_STATUS: Record<number, AiErrorKind> = {
  404: "unavailable",
  413: "too_large",
  429: "rate_limited",
  503: "unavailable",
};

/** Same cap as the function (~5 MB decoded): fail here instead of
 *  uploading a photo it would refuse. */
const MAX_IMAGE_BASE64_CHARS = 7_000_000;

async function invoke(body: { system: string; user: string; image?: ImageInput }): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("ai-complete", { body });
  if (error) {
    let reason = error.message;
    let kind: AiErrorKind = error instanceof FunctionsFetchError ? "offline" : "failed";
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      kind = KIND_BY_STATUS[res.status] ?? "failed";
      const payload = await res.json().catch(() => null);
      if (typeof payload?.error === "string") reason = payload.error;
    }
    throw new AiError(kind, `AI request failed: ${reason}`);
  }
  if (data == null || typeof data !== "object" || !("result" in data)) {
    throw new AiError("failed", "AI returned invalid JSON");
  }
  return data.result;
}

/** Text prompt → parsed JSON (Groq first, Gemini fallback, server-side). */
export async function completeJSON(system: string, user: string): Promise<unknown> {
  return invoke({ system, user });
}

/** Vision variant (Gemini first, Groq fallback, server-side). */
export async function completeJSONWithImage(
  system: string,
  user: string,
  image: ImageInput
): Promise<unknown> {
  if (image.base64.length > MAX_IMAGE_BASE64_CHARS) throw new AiError("too_large", "Photo too large");
  return invoke({ system, user, image });
}
