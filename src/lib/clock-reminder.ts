import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import i18n from "@/src/i18n";
import {
  ensureReminderChannel,
  REMINDER_CHANNEL_ID,
  REMINDER_KIND,
  REMINDER_URL,
} from "@/src/lib/reminders";
import { CLOCK_REMINDER_MS } from "@/src/utils/workout-cues";

/**
 * «¿Sigues con Jalones?»: a local notification once an exercise clock has
 * run for 30 minutes, the likely sign of one left on by mistake. When is the
 * session host's call (`@/src/utils/workout-cues` clockReminderDelay); this
 * only schedules and cancels.
 *
 * One at a time, under a fixed identifier, so each schedule replaces the
 * last; a pause, a finish or a quit cancels it, and takes one already shown
 * off the tray (it asks about a clock that has stopped). It travels as a
 * reminder (their channel and `data`: the foreground handler shows it and a
 * tap opens the Programa tab), but its identifier is outside
 * REMINDER_ID_PREFIX, so a reminders rebuild never cancels it.
 *
 * Fails soft and no-ops on web, like the reminders.
 */
const CLOCK_REMINDER_ID = "clock-running";

const isWeb = Platform.OS === "web";

/** Schedules and cancels run in order: a pause right after a start must land
    after the start's schedule, not before it. */
let queue: Promise<void> = Promise.resolve();

function serialized(task: () => Promise<void>) {
  queue = queue.then(task).catch(() => {});
}

/** Remind about `name`'s clock `delayMs` from now, replacing any pending one. */
export function scheduleClockReminder(delayMs: number, name: string) {
  if (isWeb) return;
  const fireAt = new Date(Date.now() + delayMs);
  const title = i18n.t("reminders.clockTitle", { name });
  const body = i18n.t("reminders.clockBody", { minutes: Math.round(CLOCK_REMINDER_MS / 60_000) });
  serialized(async () => {
    await ensureReminderChannel(i18n.t("reminders.channelName"));
    if (fireAt.getTime() <= Date.now()) return;
    await Notifications.scheduleNotificationAsync({
      identifier: CLOCK_REMINDER_ID,
      content: {
        title,
        body,
        data: { kind: REMINDER_KIND, url: REMINDER_URL },
        // iOS is silent without it; Android takes the channel's sound.
        sound: "default",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        channelId: REMINDER_CHANNEL_ID,
      },
    });
  });
}

/** Drop the pending reminder, and one already shown. Safe with neither. */
export function cancelClockReminder() {
  if (isWeb) return;
  serialized(async () => {
    await Notifications.cancelScheduledNotificationAsync(CLOCK_REMINDER_ID).catch(() => {});
    await Notifications.dismissNotificationAsync(CLOCK_REMINDER_ID).catch(() => {});
  });
}
