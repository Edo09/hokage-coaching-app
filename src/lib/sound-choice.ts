import AsyncStorage from "@react-native-async-storage/async-storage";

import { type SoundChoice, soundChoiceFromRow } from "@/src/utils/sound-sets";

// The coach's pick of workout sounds (src/utils/sound-sets.ts), kept on the
// device: the rest timer reads it the moment a sound plays, which may be in a
// gym with no signal. Written by useSoundChoiceSync from the coach's row; the
// row is stored as it came, so a later build that knows more sets reads
// them back without waiting for the network.

const ROW_KEY = "app_sound_choice";

let choice: SoundChoice = soundChoiceFromRow(null);
/** Set once a row has come from the database: it beats the stored one. */
let synced = false;

// Restore once at module load; classic until it resolves.
void AsyncStorage.getItem(ROW_KEY)
  .then((raw) => {
    if (raw == null || synced) return;
    choice = soundChoiceFromRow(JSON.parse(raw));
  })
  .catch(() => {});

export function getSoundChoice(): SoundChoice {
  return choice;
}

/** Apply the coach's row (null: none) and keep it for the next launch. */
export function setSoundRow(row: Record<string, unknown> | null): void {
  synced = true;
  choice = soundChoiceFromRow(row);
  void AsyncStorage.setItem(ROW_KEY, JSON.stringify(row)).catch(() => {});
}
