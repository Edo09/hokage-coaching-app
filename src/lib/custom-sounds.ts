import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import { customSoundCacheName } from "@/src/utils/sound-sets";
import { supabase } from "@/src/utils/supabase";

// The coach's own sounds (the panel's «Sonidos de la app», 'custom'), kept on
// the phone: downloaded once from the app-sounds bucket into the app's
// documents, so they play offline and without a delay. Each upload has a new
// name, so a replaced sound is a new download, and copies no moment uses any
// more are deleted. Until a file is on the phone its moment plays classic.
// On web, where the app keeps no files, a sound plays from its public URL.

const BUCKET = "app-sounds";
const isWeb = Platform.OS === "web";

const folder = () => new Directory(Paths.document, "custom-sounds");
const publicUrl = (path: string) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

/** Where an uploaded sound plays from: the phone's copy, null while there is
    none, or its URL on web. */
export function customSoundUri(path: string): string | null {
  if (isWeb) return publicUrl(path);
  try {
    const file = new File(folder(), customSoundCacheName(path));
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/** One sync at a time: a second one waits, so two never write a file at once. */
let queue: Promise<void> = Promise.resolve();

/** Make the phone hold exactly these uploads: download the missing ones and
    delete the rest. Fails soft; a file that didn't arrive is tried again at
    the next sync (the app's next open). */
export function syncCustomSounds(paths: string[]): Promise<void> {
  if (isWeb) return Promise.resolve();
  queue = queue.then(() => syncNow(paths)).catch(() => {});
  return queue;
}

async function syncNow(paths: string[]): Promise<void> {
  const dir = folder();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const keep = new Set(paths.map(customSoundCacheName));
  for (const path of paths) {
    const name = customSoundCacheName(path);
    const file = new File(dir, name);
    if (file.exists) continue;
    // Downloaded under another name and moved once whole, so a cut download
    // never passes for the sound.
    const part = new File(dir, `${name}.part`);
    try {
      await File.downloadFileAsync(publicUrl(path), part, { idempotent: true });
      await part.move(file);
    } catch {
      try {
        if (part.exists) part.delete();
      } catch {}
    }
  }
  for (const entry of dir.list()) {
    if (entry instanceof File && !keep.has(entry.name)) {
      try {
        entry.delete();
      } catch {}
    }
  }
}
