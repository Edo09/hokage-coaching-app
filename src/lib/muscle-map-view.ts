import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

// Which view the Progreso muscles card last showed — remembered on the
// device, like the weight unit (src/lib/weight-unit.ts).

/** "week": this program week (sin asignar / asignado / trabajado).
 *  "volume": sets per group over the period, as a heat map. */
export type MuscleMapView = "week" | "volume";

const VIEW_KEY = "app_muscle_map_view";

/** null until the client picks one — the card then chooses its default. */
let view: MuscleMapView | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

// Restore once at module load; until it resolves the card shows its default.
void AsyncStorage.getItem(VIEW_KEY)
  .then((stored) => {
    if (stored === "week" || stored === "volume") {
      view = stored;
      emit();
    }
  })
  .catch(() => {});

function getView(): MuscleMapView | null {
  return view;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The client's last choice, or null if they never switched. */
export function useMuscleMapView(): MuscleMapView | null {
  return useSyncExternalStore(subscribe, getView, getView);
}

/** Apply + persist. */
export async function setMuscleMapView(next: MuscleMapView) {
  if (view !== next) {
    view = next;
    emit();
  }
  try {
    await AsyncStorage.setItem(VIEW_KEY, next);
  } catch {
    // Non-fatal: the choice still applies for this session
  }
}
