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

/** public.app_sound_settings' column with the coach's own file, for each
    moment (used when the moment is set to 'custom'). */
export const CUE_FILE_COLUMNS: Record<Cue, string> = {
  start: "rest_start_file",
  warn: "rest_warn_file",
  done: "rest_done_file",
  record: "new_record_file",
  day: "day_complete_file",
};

const isSoundSet = (value: unknown): value is SoundSet =>
  (SOUND_SETS as readonly unknown[]).includes(value);

/** The coach's row as the app plays it. No row, or a set this build doesn't
    have (a later panel can offer one an older build lacks): classic. A
    moment set to the coach's own sound ('custom') reads classic here too:
    that is what plays until the file is on the phone, and what the «rest
    over» notification plays, since it can only use sounds built into the
    app (see customSoundFiles). */
export function soundChoiceFromRow(row: Record<string, unknown> | null | undefined): SoundChoice {
  const choice = { ...DEFAULT_SOUND_CHOICE };
  if (row == null) return choice;
  for (const cue of CUES) {
    const value = row[CUE_COLUMNS[cue]];
    if (isSoundSet(value)) choice[cue] = value;
  }
  return choice;
}

/** An uploaded sound in the app-sounds bucket (the panel names them so). */
const CUSTOM_FILE = /^custom\/[A-Za-z0-9_-]+\.wav$/;

/** The coach's own file for each moment set to 'custom', by its path in the
    app-sounds bucket. Anything else in the row is left out. */
export function customSoundFiles(row: Record<string, unknown> | null | undefined): Partial<Record<Cue, string>> {
  const files: Partial<Record<Cue, string>> = {};
  if (row == null) return files;
  for (const cue of CUES) {
    const path = row[CUE_FILE_COLUMNS[cue]];
    if (row[CUE_COLUMNS[cue]] === "custom" && typeof path === "string" && CUSTOM_FILE.test(path)) {
      files[cue] = path;
    }
  }
  return files;
}

/** The name of the phone's copy of an uploaded sound: each upload is a new
    path, so a new upload is a new download. */
export const customSoundCacheName = (path: string): string => path.slice("custom/".length);

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

const CHANNEL_BASE: Record<AlertMode, string> = {
  both: "rest-sound-vibrate",
  vibrate: "rest-vibrate",
  sound: "rest-sound",
};

/**
 * The vibration's version in the channel ids that vibrate. Android keeps a
 * channel's first sound and vibration for good, so a new vibration
 * (src/utils/vibration.ts) takes new channels: bump this, and add the old
 * ids to OLD_VIBRATION_CHANNELS.
 */
const VIBRATION_VERSION = "v2";

/** Channels with an earlier vibration, still on phones from older builds. */
const OLD_VIBRATION_CHANNELS = ["rest-sound-vibrate", "rest-vibrate"];

/**
 * The Android channel for the «rest over» notification. Android keeps a
 * channel's first sound and vibration for good, so each set's sound gets
 * channels of its own (the classic set has no suffix), and so does each
 * version of the vibration. Vibrate-only plays no sound, so it has one
 * channel whatever the set; sound-only doesn't vibrate, so it has no version.
 */
export function restChannelId(mode: AlertMode, set: SoundSet): string {
  const sound = mode === "vibrate" || set === "classic" ? "" : `-${set}`;
  const vibration = mode === "sound" ? "" : `-${VIBRATION_VERSION}`;
  return `${CHANNEL_BASE[mode]}${sound}${vibration}`;
}

/** The channels to drop: the other sets' sound channels, once the coach
    moves to another «rest over» sound, and the earlier vibration's (so the
    phone's notification settings list one of each, not every one ever). */
export function staleRestChannelIds(inUse: SoundSet): string[] {
  return [
    ...OLD_VIBRATION_CHANNELS,
    ...SOUND_SETS.filter((set) => set !== inUse).flatMap((set) => [
      restChannelId("both", set),
      restChannelId("sound", set),
    ]),
  ];
}
