import * as Notifications from "expo-notifications";
import { type Href, router } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

import { isReminderData, REMINDER_URL } from "@/src/lib/reminders";

/**
 * Taps already acted on, by notification id and delivery time. Module scope:
 * the tabs layout mounts again after a sign-out and sign-in, and the listener
 * and the cold-start read can both report one tap, so without this an old tap
 * would navigate again.
 */
const handled = new Set<string>();

function openReminder(response: Notifications.NotificationResponse | null) {
  if (response == null) return;
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
  const { request, date } = response.notification;
  const data = request.content.data;
  if (!isReminderData(data)) return;
  const key = `${request.identifier}@${date}`;
  if (handled.has(key)) return;
  handled.add(key);
  // Consumed: a JS reload (dev) or a later mount must not replay this tap.
  try {
    Notifications.clearLastNotificationResponse();
  } catch {}
  // data.url (always REMINDER_URL today); only a tab route is followed.
  const url =
    typeof data?.url === "string" && data.url.startsWith("/(tabs)/")
      ? (data.url as Href)
      : REMINDER_URL;
  router.push(url);
}

/** The tap that launched the app, if any. Never throws into the tabs. */
function lastResponse(): Notifications.NotificationResponse | null {
  try {
    return Notifications.getLastNotificationResponse();
  } catch {
    return null;
  }
}

/**
 * Tapping a reminder opens the Programa tab: from a cold start (the tap that
 * launched the app) and while running. Mounted in the tabs layout, so it only
 * navigates once AuthGate has settled on the tabs; any earlier and the gate's
 * own redirect would override it.
 */
export function useReminderTaps(): void {
  useEffect(() => {
    if (Platform.OS === "web") return;
    openReminder(lastResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(openReminder);
    return () => sub.remove();
  }, []);
}
