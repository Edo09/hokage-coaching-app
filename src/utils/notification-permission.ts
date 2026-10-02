// The pure half of the notification permission (src/lib/notification-permission.ts):
// how the phone's answer maps to what the reminders UI can do about it. No
// Expo, so `npm test` runs it.

/**
 * Three states, named for what the UI can do about them:
 *   granted       reminders can be scheduled;
 *   undetermined  the phone's prompt can still be shown (never asked, or
 *                 Android 13+ after a first "no", where it asks once more);
 *   denied        the phone won't prompt again: only its settings can turn
 *                 notifications on.
 */
export type PermissionStatus = "granted" | "undetermined" | "denied";

/** The fields of expo-notifications' NotificationPermissionsStatus read here. */
export type PermissionRead = {
  granted: boolean;
  canAskAgain: boolean;
  ios?: { status: number } | null;
};

/** iOS provisional authorization (expo-notifications'
    IosAuthorizationStatus.PROVISIONAL): delivered quietly to Notification
    Center, so reminders still arrive. */
export const IOS_PROVISIONAL = 3;

export function toPermissionStatus(p: PermissionRead): PermissionStatus {
  if (p.granted || p.ios?.status === IOS_PROVISIONAL) return "granted";
  return p.canAskAgain ? "undetermined" : "denied";
}

/** `read()`'s answer as a status. A read that fails counts as denied: no
    reminders, and no prompt the phone might refuse to show. */
export async function readPermissionStatus(
  read: () => Promise<PermissionRead>,
): Promise<PermissionStatus> {
  try {
    return toPermissionStatus(await read());
  } catch {
    return "denied";
  }
}

/** Shows the phone's prompt (`request`) only while it can still be shown, and
    returns the outcome. Never prompts when already granted or denied. */
export async function requestPermissionStatus(
  read: () => Promise<PermissionRead>,
  request: () => Promise<PermissionRead>,
): Promise<PermissionStatus> {
  try {
    const current = toPermissionStatus(await read());
    if (current !== "undetermined") return current;
    return toPermissionStatus(await request());
  } catch {
    return "denied";
  }
}
