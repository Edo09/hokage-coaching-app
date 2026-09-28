import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

// How the rest timer gets the client's attention when a rest starts and ends:
// sound and vibration, vibration only, or sound only. A per-device choice
// (Ajustes), like the weight unit: a phone kept on silent at the gym and one
// with headphones in want different things.

export type AlertMode = "both" | "vibrate" | "sound";

export const ALERT_MODES: AlertMode[] = ["both", "vibrate", "sound"];

const MODE_KEY = "app_rest_alert_mode";

let mode: AlertMode = "both";
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

// Restore once at module load; "both" until it resolves.
void AsyncStorage.getItem(MODE_KEY)
  .then((stored) => {
    if (stored === "both" || stored === "vibrate" || stored === "sound") {
      mode = stored;
      emit();
    }
  })
  .catch(() => {});

export function getAlertMode(): AlertMode {
  return mode;
}

export const alertVibrates = (m: AlertMode) => m !== "sound";
export const alertSounds = (m: AlertMode) => m !== "vibrate";

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAlertMode(): AlertMode {
  return useSyncExternalStore(subscribe, getAlertMode, getAlertMode);
}

/** Persist + apply. */
export async function setAlertMode(next: AlertMode) {
  if (mode !== next) {
    mode = next;
    emit();
  }
  try {
    await AsyncStorage.setItem(MODE_KEY, next);
  } catch {
    // Non-fatal: the mode still applies for this session
  }
}
