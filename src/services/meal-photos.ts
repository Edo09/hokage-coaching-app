import { supabase } from "@/src/utils/supabase";
import { isDuplicateUpload } from "@/src/utils/photo-queue";

// Meal photos live in a public Supabase Storage bucket under
// "<userId>/<uuid>.<ext>". Public URLs are deterministic and synchronous,
// which keeps meal thumbnails cacheable (expo-image disk cache) and
// offline-friendly. Writes are RLS-scoped to the owner's folder. Uploads go
// through the photo queue (src/lib/photo-queue.ts).

const BUCKET = "meal-photos";

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
