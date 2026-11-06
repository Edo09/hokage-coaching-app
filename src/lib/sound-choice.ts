import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  type Cue,
  customSoundFiles,
  type SoundChoice,
  soundChoiceFromRow,
} from "@/src/utils/sound-sets";

// The coach's pick of workout sounds (src/utils/sound-sets.ts), kept on the
// device: the rest timer reads it the moment a sound plays, which may be in a
// gym with no signal. Written by useSoundChoiceSync from the coach's row; the
// row is stored as it came, so a later build that knows more sets reads
// them back without waiting for the network. The coach's own files are
// downloaded by src/lib/custom-sounds.ts.

const ROW_KEY = "app_sound_choice";

let choice: SoundChoice = soundChoiceFromRow(null);
let customFiles: Partial<Record<Cue, string>> = {};
/** Set once a row has come from the database: it beats the stored one. */
let synced = false;

function apply(row: Record<string, unknown> | null) {
  choice = soundChoiceFromRow(row);
  customFiles = customSoundFiles(row);
}

// Restore once at module load; classic until it resolves.
void AsyncStorage.getItem(ROW_KEY)
  .then((raw) => {
    if (raw == null || synced) return;
    apply(JSON.parse(raw));
  })
  .catch(() => {});

/** The built-in set of each moment (classic where the coach's own sound is
    picked: it plays until that file is on the phone, and in the «rest over»
    notification). */
export function getSoundChoice(): SoundChoice {
  return choice;
}

/** The coach's own file of each moment set to it, by bucket path. */
export function getCustomSoundFiles(): Partial<Record<Cue, string>> {
  return customFiles;
}

/** Apply the coach's row (null: none) and keep it for the next launch. */
export function setSoundRow(row: Record<string, unknown> | null): void {
  synced = true;
  apply(row);
  void AsyncStorage.setItem(ROW_KEY, JSON.stringify(row)).catch(() => {});
}
