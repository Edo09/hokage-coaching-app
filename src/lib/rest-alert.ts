import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from "expo-audio";
import { AppState, Platform, Vibration } from "react-native";

import i18n from "@/src/i18n";
import { alertSounds, alertVibrates, type AlertMode, getAlertMode } from "@/src/lib/alert-mode";

/**
 * How the client learns their rest is over.
 *
 * Three signals, because one is never enough in a gym: a vibration pattern, a
 * chime, and — for the case that actually matters — a local notification, since
 * the phone is usually face-down on a bench with the app backgrounded and JS
 * frozen. The first two only exist while the app is foregrounded; the
 * notification is what survives a locked screen.
 *
 * All three fail soft. A denied permission, a muted device or an audio session
 * the OS refuses must never break the countdown itself.
 *
 * Which of sound and vibration play is the client's choice (Ajustes, see
 * `@/src/lib/alert-mode`), read at the moment each alert fires or is
 * scheduled. Starting a rest gets a short cue in the same mode.
 */

/**
 * Android channel per alert mode. Android takes sound and vibration from the
 * channel, and a channel is immutable once created, so each mode is its own
 * channel and a scheduled notification asks for the one matching the mode.
 */
const CHANNELS: Record<AlertMode, string> = {
  both: "rest-sound-vibrate",
  vibrate: "rest-vibrate",
  sound: "rest-sound",
};

/** Bundled by the expo-notifications plugin (app.json). Android resource
    names allow only a-z, 0-9 and "_", hence the underscores. */
const DONE_SOUND = "rest_done.wav";
/** iOS only buzzes for a notification that has a sound, so "vibrate only"
    plays silence. */
const SILENT_SOUND = "rest_silent.wav";

/**
 * [wait, buzz, wait, buzz]. Two pulses reads as "done" where one reads as an
 * incidental notification. Android honours the durations; iOS ignores them and
 * fires its fixed-length vibration at each offset, which is the intent anyway.
 */
const VIBRATION_PATTERN = [0, 400, 180, 400];

/** A single short buzz for a rest starting: acknowledged, not an alarm. */
const START_VIBRATION_MS = 70;

const isWeb = Platform.OS === "web";

const SOUNDS = {
  done: require("@/assets/sounds/rest_done.wav"),
  start: require("@/assets/sounds/rest_start.wav"),
};
const players: Partial<Record<keyof typeof SOUNDS, AudioPlayer>> = {};

/**
 * Built on demand, not at import: constructing a player allocates a decoder (and
 * on web fetches the asset), and most sessions — nutrition, progress — never
 * start a rest timer. `primeRestAlert` is what keeps that cost off the moment
 * the chime has to sound.
 */
function getPlayer(sound: keyof typeof SOUNDS): AudioPlayer | null {
  const existing = players[sound];
  if (existing != null) return existing;
  try {
    const created = createAudioPlayer(SOUNDS[sound]);
    players[sound] = created;
    return created;
  } catch {
    return null;
  }
}

function play(sound: keyof typeof SOUNDS) {
  const p = getPlayer(sound);
  if (p == null) return;
  try {
    // Rewind first: the player holds its position from the previous rest, and
    // a finished player replays nothing until it is seeked back to 0. Don't
    // await it — a seek that resolves after the play() still lands in time, and
    // waiting would add latency to the one call that must not have any.
    p.seekTo(0).catch(() => {});
    p.play();
  } catch {}
}

/** Channels already created this session (creating is idempotent, but async). */
const createdChannels = new Set<AlertMode>();

/** Create the Android channel for this mode if this session hasn't yet. */
async function ensureChannel(mode: AlertMode): Promise<void> {
  if (Platform.OS !== "android" || createdChannels.has(mode)) return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNELS[mode], {
      name: i18n.t(`settings.restAlertChannel_${mode}`),
      importance: Notifications.AndroidImportance.HIGH,
      // null = no sound (vibrate only).
      sound: alertSounds(mode) ? DONE_SOUND : null,
      enableVibrate: alertVibrates(mode),
      vibrationPattern: alertVibrates(mode) ? VIBRATION_PATTERN : null,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      // ALARM usage, not NOTIFICATION: it plays on the alarm stream, so a phone
      // silenced for the gym still ends the set audibly. Same call as
      // playsInSilentMode on iOS.
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.ALARM,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      },
    });
    createdChannels.add(mode);
  } catch {}
}

/**
 * Idempotent app-start wiring: audio session, Android channel, foreground
 * behaviour. Safe to call from module scope alongside the other setup helpers.
 */
export function setupRestAlerts() {
  if (isWeb) return;

  // playsInSilentMode: a rest timer is an alarm. Someone who muted their phone
  // to lift still expects the set to end audibly — same contract as the stock
  // clock app. duckOthers dips their music for the chime instead of stopping it.
  setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: "duckOthers",
    shouldPlayInBackground: false,
    allowsRecording: false,
  }).catch(() => {});

  // Foreground finishes are already covered by the chime and the vibration
  // above, so the OS notification would double up. Suppress it rather than
  // skipping the schedule: whether the app is foregrounded at 0:00 is not
  // knowable when the timer starts.
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const active = AppState.currentState === "active";
      return {
        shouldShowBanner: !active,
        shouldShowList: !active,
        shouldPlaySound: !active,
        shouldSetBadge: false,
      };
    },
  });

  // The channel for the default mode, so Android 13+ has one to attach the
  // notification-permission prompt to. Other modes' channels are created when
  // first used (scheduleRestDoneNotification).
  void ensureChannel(getAlertMode());
}

/**
 * Build the player now so 0:00 costs nothing but a `play()`. Called when a rest
 * starts: loading the asset at fire time makes the chime arrive late, which on
 * a 90s rest is exactly the beat the client is listening for.
 */
export function primeRestAlert() {
  if (alertSounds(getAlertMode())) getPlayer("done");
}

/**
 * Buzz and/or chime, per the alert mode. Needs JS to be running, so on native
 * this only covers a foregrounded finish — the notification covers the rest.
 * On web it also fires from a hidden tab, which is the only signal that
 * surface has. `mode` defaults to the saved one (Ajustes passes the option
 * being previewed).
 */
export function playRestDoneAlert(mode: AlertMode = getAlertMode()) {
  if (!isWeb && alertVibrates(mode)) {
    try {
      Vibration.vibrate(VIBRATION_PATTERN);
    } catch {}
  }
  if (alertSounds(mode)) play("done");
}

/**
 * A rest just started: a short buzz and/or a quick two-note cue, per the
 * alert mode, so the client knows the tap landed without looking.
 */
export function playRestStartAlert(mode: AlertMode = getAlertMode()) {
  if (!isWeb && alertVibrates(mode)) {
    // iOS ignores vibration durations (every buzz is ~0.4 s, too much for an
    // acknowledgement); a heavy haptic tap is its short buzz.
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    } else {
      try {
        Vibration.vibrate(START_VIBRATION_MS);
      } catch {}
    }
  }
  if (alertSounds(mode)) play("start");
}

/**
 * Id of the pending completion notification, and a token that invalidates it.
 *
 * Scheduling is async while stopping a timer is not, so a client who starts and
 * immediately skips a rest can have the cancel land before the id exists. The
 * token is bumped by every schedule and every cancel; a schedule whose token is
 * stale by the time it resolves cancels the notification it just created.
 */
let pendingId: string | null = null;
let token = 0;

/**
 * Latched once granted, so the happy path is a plain boolean read. A denial is
 * deliberately NOT cached: someone who declines the prompt mid-workout and then
 * turns notifications on in Settings should get them on the next set, not after
 * an app restart. `requestPermissionsAsync` no-ops once the OS has stopped
 * asking, so re-checking costs nothing and never re-prompts.
 */
let granted = false;

async function ensurePermission(): Promise<boolean> {
  if (granted) return true;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) {
      granted = true;
    } else if (current.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
  } catch {
    return false;
  }
  return granted;
}

/**
 * Schedule the "rest is over" notification `seconds` out, replacing any
 * pending one. Call on every change to the end time — start, resume, +30s.
 *
 * On Android it only fires on time with exact-alarm access ("Alarms &
 * reminders", denied by default on Android 14+); without it the OS may deliver
 * it late. Ajustes asks for it — see `@/modules/exact-alarms`. The app declares
 * SCHEDULE_EXACT_ALARM only: Play reserves USE_EXACT_ALARM for apps whose core
 * function is an alarm, timer or calendar.
 */
export function scheduleRestDoneNotification(seconds: number, label?: string | null) {
  // expo-notifications has no local scheduling on web, and the PWA is a
  // secondary surface here — the foreground chime covers it.
  if (isWeb || seconds <= 0) return;

  cancelRestDoneNotification();
  const mine = token;
  const mode = getAlertMode();

  void (async () => {
    await ensureChannel(mode);
    if (!(await ensurePermission())) return;
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: i18n.t("program.restDone"),
          body: label
            ? i18n.t("program.restNotifNext", { name: label })
            : i18n.t("program.restNotifBody"),
          // iOS reads the sound off the notification (and only buzzes when
          // there is one, hence silence for "vibrate only"); Android ignores
          // this and uses the channel's.
          sound: alertSounds(mode) ? DONE_SOUND : SILENT_SOUND,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds,
          repeats: false,
          channelId: CHANNELS[mode],
        },
      });
      if (token !== mine) {
        // Cancelled while we were scheduling — undo it.
        void Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
        return;
      }
      pendingId = id;
    } catch {}
  })();
}

/** Drop any pending completion notification. Safe to call when there is none. */
export function cancelRestDoneNotification() {
  if (isWeb) return;
  token += 1;
  const id = pendingId;
  pendingId = null;
  if (id == null) return;
  Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
}
