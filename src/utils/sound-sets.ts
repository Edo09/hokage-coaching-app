import type { AlertMode } from "@/src/lib/alert-mode";

// Which sound plays at each moment of a workout. The coach picks a set per
// moment in the panel («Sonidos de la app», one row in
// public.app_sound_settings); the files themselves are built into the app
// (assets/sounds), so a new set takes a new build. Pure: the players and the
// notification channels are in src/lib/rest-alert.ts.

export const SOUND_SETS = ["classic", "bells", "ring", "arcade"] as const;
export type SoundSet = (typeof SOUND_SETS)[number];

/** A rest starts, 10 seconds left, the rest is over, a new record, a day done. */
export const CUES = ["start", "warn", "done", "record", "day"] as const;
export type Cue = (typeof CUES)[number];

export type SoundChoice = Record<Cue, SoundSet>;

export const DEFAULT_SOUND_CHOICE: SoundChoice = {
  start: "classic",
  warn: "classic",
  done: "classic",
  record: "classic",
  day: "classic",
};

/** public.app_sound_settings' column for each moment. */
export const CUE_COLUMNS: Record<Cue, string> = {
  start: "rest_start",
  warn: "rest_warn",
  done: "rest_done",
  record: "new_record",
  day: "day_complete",
};

const isSoundSet = (value: unknown): value is SoundSet =>
  (SOUND_SETS as readonly unknown[]).includes(value);

/** The coach's row as the app plays it. No row, or a set this build doesn't
    have (a later panel can offer one an older build lacks): classic. */
export function soundChoiceFromRow(row: Record<string, unknown> | null | undefined): SoundChoice {
  const choice = { ...DEFAULT_SOUND_CHOICE };
  if (row == null) return choice;
  for (const cue of CUES) {
    const value = row[CUE_COLUMNS[cue]];
    if (isSoundSet(value)) choice[cue] = value;
  }
  return choice;
}

/** The classic set keeps the names it shipped with (rest_done.wav is also a
    notification sound, by that name). */
const CLASSIC_FILES: Record<Cue, string> = {
  start: "rest_start.wav",
  warn: "rest_warn.wav",
  done: "rest_done.wav",
  record: "record.wav",
  day: "day_done.wav",
};

/** The file in assets/sounds. Android resource names: a-z, 0-9 and "_". */
export function soundFileName(set: SoundSet, cue: Cue): string {
  return set === "classic" ? CLASSIC_FILES[cue] : `${set}_${cue}.wav`;
}

const CLASSIC_CHANNELS: Record<AlertMode, string> = {
  both: "rest-sound-vibrate",
  vibrate: "rest-vibrate",
  sound: "rest-sound",
};

/**
 * The Android channel for the «rest over» notification. Android keeps a
 * channel's first sound for good, so each set's sound gets channels of its
 * own; the classic set keeps the ids it shipped with, and vibrate-only plays
 * no sound, so it has one channel whatever the set.
 */
export function restChannelId(mode: AlertMode, set: SoundSet): string {
  const base = CLASSIC_CHANNELS[mode];
  return mode === "vibrate" || set === "classic" ? base : `${base}-${set}`;
}

/** The sound channels of the sets not in use, to drop once the coach moves
    to another «rest over» sound (so Ajustes doesn't list each one). */
export function staleRestChannelIds(inUse: SoundSet): string[] {
  return SOUND_SETS.filter((set) => set !== inUse).flatMap((set) => [
    restChannelId("both", set),
    restChannelId("sound", set),
  ]);
}
