import * as Notifications from "expo-notifications";
import type { Href } from "expo-router";
import type { TFunction } from "i18next";
import { Platform } from "react-native";

import { type PlannedReminder, REMINDER_ID_PREFIX } from "@/src/utils/reminders";

/**
 * Local reminders (training day, inactivity, week opened): the scheduling
 * half. What to remind and when comes from the pure planner
 * (`@/src/utils/reminders`); this turns that plan into OS notifications, one
 * DATE trigger each. There are no repeating triggers, so every rebuild
 * replaces the whole set (`useReminderSync`).
 *
 * Every reminder's identifier starts with REMINDER_ID_PREFIX (spelled once, in
 * the planner). That is how a rebuild finds and replaces exactly the reminders
 * and never touches the rest-timer alert (`@/src/lib/rest-alert`), whose id
 * expo-notifications generates.
 *
 * Fails soft, like the rest alert: a refused schedule or a missing permission
 * never throws into the screens. No-ops on web, which has no local
 * notifications.
 */

export const REMINDER_CHANNEL_ID = "reminders";
export { REMINDER_ID_PREFIX };
/** `data.kind` on every reminder: the foreground handler shows these, and a
    tap on one opens the Programa tab. */
export const REMINDER_KIND = "reminder";
/** Where tapping a reminder lands. */
export const REMINDER_URL: Href = "/(tabs)/routines";

const isWeb = Platform.OS === "web";

/** True for a notification's `content.data` when it is one of ours. */
export function isReminderData(data: Record<string, unknown> | null | undefined): boolean {
  return data?.kind === REMINDER_KIND;
}

/**
 * Create the Android channel, or rename it: Android keeps a channel's
 * sound and importance once it exists (and the client can change them), but
 * it does take a new name, so calling this again in another language renames
 * it. Default importance: a reminder, not an alarm like the rest alert.
 */
export async function ensureReminderChannel(name: string): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name,
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch {}
}

/**
 * Cancel and schedule run one at a time. A rebuild that starts while the last
 * one is still cancelling or scheduling would interleave with it and leave
 * duplicates or gaps; and a sign-out cancel must land after a rebuild in flight.
 */
let queue: Promise<void> = Promise.resolve();

function serialized(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task).catch(() => {});
  return queue;
}

async function cancelScheduled(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(REMINDER_ID_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})),
  );
}

async function replaceScheduled(plan: PlannedReminder[], t: TFunction): Promise<void> {
  await cancelScheduled();
  if (plan.length === 0) return;
  await ensureReminderChannel(t("reminders.channelName"));
  for (const reminder of plan) {
    // The plan was built a moment ago; a time that has passed since would fire
    // at once (or be refused), so it is dropped instead.
    if (reminder.fireAt.getTime() <= Date.now()) continue;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: reminder.id,
        content: {
          title: t(reminder.titleKey, reminder.params),
          body: t(reminder.bodyKey, reminder.params),
          data: { kind: REMINDER_KIND, url: REMINDER_URL },
          // iOS is silent without it; Android takes the channel's sound.
          sound: "default",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: reminder.fireAt,
          channelId: REMINDER_CHANNEL_ID,
        },
      });
    } catch {}
  }
}

/**
 * Replace every scheduled reminder with `plan`, texts in `t`'s language.
 * Pass an empty plan to only cancel. The rest alert is never touched.
 */
export function syncReminders(plan: PlannedReminder[], t: TFunction): Promise<void> {
  if (isWeb) return Promise.resolve();
  return serialized(() => replaceScheduled(plan, t));
}

/**
 * Bumped by every cancelReminders(). A rebuild planned before a cancel (the
 * sync hook's debounce still pending when the client signs out) reads it
 * again before scheduling and gives up, so the previous client's plan can't
 * land after the sign-out cancel.
 */
let generation = 0;

export function reminderGeneration(): number {
  return generation;
}

/** Cancel every scheduled reminder (sign-out, permission gone). */
export function cancelReminders(): Promise<void> {
  generation++;
  if (isWeb) return Promise.resolve();
  return serialized(cancelScheduled);
}
