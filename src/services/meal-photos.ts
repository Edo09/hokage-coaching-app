import { newId } from "@/src/lib/ids";
import type { ImageInput } from "@/src/services/llm";
import { supabase } from "@/src/utils/supabase";
import { isDuplicateUpload } from "@/src/utils/photo-queue";

// Meal photos live in a public Supabase Storage bucket under
// "<userId>/<uuid>.<ext>". Public URLs are deterministic and synchronous,
// which keeps diary thumbnails cacheable (expo-image disk cache) and
// offline-friendly. Writes are RLS-scoped to the owner's folder.

const BUCKET = "meal-photos";

function base64ToBytes(b64: string): Uint8Array {
  const binary = globalThis.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Uploads a picked photo; returns its storage path, or null on failure
 *  (photo persistence is best-effort — the food entry still saves). */
export async function uploadMealPhoto(
  userId: string,
  image: ImageInput,
): Promise<string | null> {
  try {
    const ext = image.mimeType === "image/png" ? "png" : "jpg";
    const path = `${userId}/${newId()}.${ext}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, base64ToBytes(image.base64).buffer as ArrayBuffer, {
        contentType: image.mimeType,
      });
    if (error) throw error;
    return path;
  } catch (e) {
    console.warn("[meal-photos] upload failed:", (e as Error)?.message ?? e);
    return null;
  }
}

/** Uploads to a path chosen in advance (the photo queue keeps it across
 *  retries). "duplicate": the file is already there, from a try whose answer
 *  was lost. */
export async function uploadMealPhotoBytes(
  path: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<"stored" | "duplicate" | "failed"> {
  try {
    const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType });
    if (!error) return "stored";
    if (isDuplicateUpload(error)) return "duplicate";
    console.warn("[meal-photos] upload failed:", error.message);
    return "failed";
  } catch (e) {
    if (isDuplicateUpload(e)) return "duplicate";
    console.warn("[meal-photos] upload failed:", (e as Error)?.message ?? e);
    return "failed";
  }
}

/** Deterministic public URL for a stored photo path. */
export function mealPhotoUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Best-effort cleanup when an item is removed (no offline queue for files —
 *  an orphaned object is harmless and invisible). */
export function removeMealPhoto(path: string): void {
  supabase.storage
    .from(BUCKET)
    .remove([path])
    .catch(() => {});
}
