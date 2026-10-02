import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import { AppState, Linking, Platform } from "react-native";

import {
  type PermissionStatus,
  readPermissionStatus,
  requestPermissionStatus,
} from "@/src/utils/notification-permission";

export type { PermissionStatus };

// Notification permission for the local reminders (onboarding's last step and
// Ajustes → Notificaciones). The rest timer still asks on its own the first
// time a rest starts (src/lib/rest-alert.ts), for clients who skipped. What
// each status means, and how the phone's answer maps to it, is in
// src/utils/notification-permission.ts.
// Web has no local notifications: there everything reads "denied" and nothing
// prompts or opens.

const isWeb = Platform.OS === "web";

/** Every mounted usePermissionStatus re-reads when this fires. */
const listeners = new Set<() => void>();

function permissionChanged() {
  listeners.forEach((listener) => listener());
}

export function getPermissionStatus(): Promise<PermissionStatus> {
  if (isWeb) return Promise.resolve("denied");
  return readPermissionStatus(Notifications.getPermissionsAsync);
}

/** Shows the phone's prompt when it still can, and returns the result. Never
    prompts when already granted or denied. */
export async function requestPermission(): Promise<PermissionStatus> {
  if (isWeb) return "denied";
  try {
    return await requestPermissionStatus(
      Notifications.getPermissionsAsync,
      Notifications.requestPermissionsAsync,
    );
  } finally {
    // Android's prompt doesn't always move AppState, so tell the hooks.
    permissionChanged();
  }
}

/** The app's page in the phone's settings, where a denied permission is
    turned back on. */
export async function openNotificationSettings(): Promise<void> {
  if (isWeb) return;
  try {
    await Linking.openSettings();
  } catch {}
}

/**
 * The current status, re-read when the app returns to the foreground (the
 * client may have just changed it in the phone's settings) and after
 * `requestPermission`. `null` until the first read resolves. `refresh`
 * re-reads it in every mounted copy of this hook.
 */
export function usePermissionStatus(): {
  status: PermissionStatus | null;
  refresh: () => void;
} {
  const [status, setStatus] = useState<PermissionStatus | null>(isWeb ? "denied" : null);

  useEffect(() => {
    if (isWeb) return;
    let alive = true;
    const read = () => {
      void getPermissionStatus().then((next) => {
        if (alive) setStatus(next);
      });
    };
    read();
    listeners.add(read);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") read();
    });
    return () => {
      alive = false;
      listeners.delete(read);
      sub.remove();
    };
  }, []);

  return { status, refresh: permissionChanged };
}
