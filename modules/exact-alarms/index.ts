import { requireOptionalNativeModule } from "expo";
import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";

/**
 * Android's exact-alarm access, "Alarms & reminders" in system settings.
 *
 * expo-notifications schedules the rest-done notification on an exact alarm
 * when the app has it and silently falls back to an inexact one when it
 * doesn't, which Android may deliver well after the requested time (up to 75%
 * of the delay late: a 90 s rest can end at ~2:37). Android 14+ denies it by
 * default on a fresh install, and only the user can grant it.
 *
 * Android only (native side in ./android). iOS, web and a build that predates
 * the native module all read as allowed, so nothing asks for it there.
 */
type ExactAlarmsNative = {
  canScheduleExactAlarms(): boolean;
  openExactAlarmSettings(): boolean;
};

const native =
  Platform.OS === "android" ? requireOptionalNativeModule<ExactAlarmsNative>("ExactAlarms") : null;

export function canScheduleExactAlarms(): boolean {
  try {
    return native?.canScheduleExactAlarms() ?? true;
  } catch {
    return true;
  }
}

/** Open the app's "Alarms & reminders" toggle. False if nothing opened. */
export function openExactAlarmSettings(): boolean {
  try {
    return native?.openExactAlarmSettings() ?? false;
  } catch {
    return false;
  }
}

/**
 * Live `canScheduleExactAlarms()`. Re-read when the app returns to the
 * foreground, which is how the user comes back from the settings page.
 */
export function useCanScheduleExactAlarms(): boolean {
  const [allowed, setAllowed] = useState(canScheduleExactAlarms);

  useEffect(() => {
    if (native == null) return;
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") setAllowed(canScheduleExactAlarms());
    });
    return () => sub.remove();
  }, []);

  return allowed;
}
