import * as Notifications from "expo-notifications";
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from "expo-audio";
import { AppState, Platform, Vibration } from "react-native";

import i18n from "@/src/i18n";

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
 */

/** Android channel id. Must match what the scheduled notification asks for. */
const CHANNEL_ID = "rest-timer";

/**
 * [wait, buzz, wait, buzz]. Two pulses reads as "done" where one reads as an
 * incidental notification. Android honours the durations; iOS ignores them and
 * fires its fixed-length vibration at each offset, which is the intent anyway.
 */
const VIBRATION_PATTERN = [0, 400, 180, 400];

const isWeb = Platform.OS === "web";

let player: AudioPlayer | null = null;

/**
 * Built on demand, not at import: constructing a player allocates a decoder (and
 * on web fetches the asset), and most sessions — nutrition, progress — never
 * start a rest timer. `primeRestAlert` is what keeps that cost off the moment
 * the chime has to sound.
 */
function getPlayer(): AudioPlayer | null {
  if (player != null) return player;
  try {
    player = createAudioPlayer(require("@/assets/sounds/rest-done.wav"));
    return player;
  } catch {
    return null;
  }
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

  if (Platform.OS === "android") {
    // Android takes sound and vibration from the channel, not the notification,
    // and a channel is immutable once created — changing these later needs a
    // new id or an app reinstall.
    Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Rest timer",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "rest-done.wav",
      vibrationPattern: VIBRATION_PATTERN,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      enableVibrate: true,
      // ALARM usage, not NOTIFICATION: it plays on the alarm stream, so a phone
      // silenced for the gym still ends the set audibly. Same call as
      // playsInSilentMode on iOS.
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.ALARM,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      },
    }).catch(() => {});
  }
}

/**
 * Build the player now so 0:00 costs nothing but a `play()`. Called when a rest
 * starts: loading the asset at fire time makes the chime arrive late, which on
 * a 90s rest is exactly the beat the client is listening for.
 */
export function primeRestAlert() {
  getPlayer();
}

/**
 * Buzz + chime. Needs JS to be running, so on native this only covers a
 * foregrounded finish — the notification covers the rest. On web it also fires
 * from a hidden tab, which is the only signal that surface has.
 */
export function playRestDoneAlert() {
  if (!isWeb) {
    try {
      Vibration.vibrate(VIBRATION_PATTERN);
    } catch {}
  }

  const p = getPlayer();
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
 */
export function scheduleRestDoneNotification(seconds: number, label?: string | null) {
  // expo-notifications has no local scheduling on web, and the PWA is a
  // secondary surface here — the foreground chime covers it.
  if (isWeb || seconds <= 0) return;

  cancelRestDoneNotification();
  const mine = token;

  void (async () => {
    if (!(await ensurePermission())) return;
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: i18n.t("program.restDone"),
          body: label
            ? i18n.t("program.restNotifNext", { name: label })
            : i18n.t("program.restNotifBody"),
          // iOS reads the sound off the notification; Android ignores this one
          // and uses the channel's.
          sound: "rest-done.wav",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds,
          repeats: false,
          channelId: CHANNEL_ID,
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
