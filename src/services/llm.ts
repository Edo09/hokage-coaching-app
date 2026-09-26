import { FunctionsHttpError } from "@supabase/supabase-js";

import { supabase } from "@/src/utils/supabase";

// Shared LLM access through the ai-complete Edge Function
// (supabase/functions/ai-complete). The function holds the Groq/Gemini keys
// as secrets — they are not in the app bundle — checks the caller is signed
// in, applies a per-user quota, and returns the model's JSON already parsed.

export type ImageInput = { base64: string; mimeType: string };

/** Same cap as the function (~5 MB decoded): fail here instead of
 *  uploading a photo it would refuse. */
const MAX_IMAGE_BASE64_CHARS = 7_000_000;

async function invoke(body: { system: string; user: string; image?: ImageInput }): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("ai-complete", { body });
  if (error) {
    let reason = error.message;
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      if (typeof payload?.error === "string") reason = payload.error;
    }
    throw new Error(`AI request failed: ${reason}`);
  }
  if (data == null || typeof data !== "object" || !("result" in data)) {
    throw new Error("AI returned invalid JSON");
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
  if (image.base64.length > MAX_IMAGE_BASE64_CHARS) throw new Error("Photo too large");
  return invoke({ system, user, image });
}
