import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/src/hooks/use-auth";
import { useMeals } from "@/src/hooks/use-meals";
import i18n from "@/src/i18n";
import { newId } from "@/src/lib/ids";
import { enqueue } from "@/src/lib/outbox";
import { cancelPhotoJob, hasQueuedPhoto, queuePhotoJob, updateQueuedRow } from "@/src/lib/photo-queue";
import { qk } from "@/src/lib/query-keys";
import { useToday } from "@/src/lib/today";
import { removeMealPhoto } from "@/src/services/meal-photos";
import type { MealItem, MealWithItems, NutritionPlanMeal } from "@/src/types/database";
import { toDateKey } from "@/src/utils/dates";
import { removeItemFromCache, upsertItemInCache } from "@/src/utils/meal-cache";
import {
  buildContainer,
  buildRegistrationRow,
  mealsOnDate,
  type RegistrationChoice,
  registrationsByPlanMeal,
} from "@/src/utils/meal-registration";
import { mealTypeToDiarySlot } from "@/src/utils/nutrition-plan";

// Today's meal registrations and the three things a client does with them.
// Writes are local-first like the rest of the app: the cache changes at once
// and the outbox syncs. A registration is an upsert under an id derived from
// the client, the day and the plan meal, after an insert of its container
// that ignores an existing one, so a second device or a repeated save
// updates the same row. Containers are never deleted.

/** A photo picked in the sheet (useMealPhotoPicker). */
export type PickedPhoto = { uri: string; mimeType: string };
export type PhotoChange = { kind: "keep" } | { kind: "remove" } | { kind: "new"; photo: PickedPhoto };
export type RegisterInput = {
  meal: NutritionPlanMeal;
  displayName: string;
  choice: RegistrationChoice;
  photo: PhotoChange;
};

export function useMealRegistrations() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { meals, refresh } = useMeals();
  // Day-reactive: useToday re-renders at midnight, so the list moves on.
  const todayKey = toDateKey(useToday());
  const todays = mealsOnDate(meals, todayKey);
  const registrations = registrationsByPlanMeal(todays);

  const setMeals = (update: (old: MealWithItems[]) => MealWithItems[]) => {
    queryClient.setQueryData<MealWithItems[]>(qk.meals(user?.id), (old = []) => update(old));
  };

  const register = async ({ meal, displayName, choice, photo }: RegisterInput) => {
    if (!user) return;
    const now = new Date().toISOString();
    const previous = registrations.get(meal.id) ?? null;
    const slot = mealTypeToDiarySlot(meal.meal_type);
    const container = buildContainer({
      userId: user.id,
      dateKey: todayKey,
      mealType: slot,
      name: i18n.t(`meals.${slot}`),
      now,
    });
    // A photo only uploaded, not queued, is a file to clean up if replaced.
    const oldUploaded = previous?.photo_path != null && !hasQueuedPhoto(previous.id) ? previous.photo_path : null;

    let photoPath: string | null = null;
    let picked: PickedPhoto | null = null;
    if (choice.kind !== "skipped" && photo.kind === "keep") {
      photoPath = previous?.photo_path ?? null;
    } else if (choice.kind !== "skipped" && photo.kind === "new") {
      picked = photo.photo;
      photoPath = `${user.id}/${newId()}.${picked.mimeType === "image/png" ? "png" : "jpg"}`;
    }
    const row = buildRegistrationRow({
      userId: user.id,
      dateKey: todayKey,
      meal,
      displayName,
      choice,
      photoPath,
      previous,
      now,
    });

    setMeals((old) => upsertItemInCache(old, container, row));

    let saved = row;
    if (picked != null && photoPath != null) {
      try {
        // The queue hands the row to the outbox once the photo is stored.
        await queuePhotoJob({
          userId: user.id,
          registrationId: row.id,
          sourceUri: picked.uri,
          mimeType: picked.mimeType,
          storagePath: photoPath,
          container,
          row,
        });
        if (oldUploaded != null && oldUploaded !== row.photo_path) removeMealPhoto(oldUploaded);
        return;
      } catch (e) {
        // The picked file couldn't be kept (a bad uri, a full disk): the meal
        // still saves, without its photo, as when an upload is given up.
        console.warn("[meal-registrations] photo not queued:", (e as Error)?.message ?? e);
        saved = { ...row, photo_path: null };
        setMeals((old) => upsertItemInCache(old, container, saved));
      }
    } else if (photo.kind === "keep" && choice.kind !== "skipped" && (await updateQueuedRow(row.id, row))) {
      // Its photo is still uploading: the queued job carries the new row.
      return;
    }
    await cancelPhotoJob(row.id);
    await enqueue({ userId: user.id, table: "meals", kind: "insert", payload: { ...container } });
    await enqueue({ userId: user.id, table: "meal_items", kind: "upsert", payload: { ...saved } });
    if (oldUploaded != null && oldUploaded !== saved.photo_path) removeMealPhoto(oldUploaded);
  };

  const undo = async (item: MealItem) => {
    if (!user) return;
    const queued = hasQueuedPhoto(item.id);
    await cancelPhotoJob(item.id);
    setMeals((old) => removeItemFromCache(old, item.id));
    await enqueue({ userId: user.id, table: "meal_items", kind: "delete", payload: { id: item.id } });
    if (item.photo_path != null && !queued) removeMealPhoto(item.photo_path);
  };

  /** «Sin estimar» tapped: mark failed estimates pending again; the server
   *  takes that as a retry. */
  const retry = async (items: MealItem[]) => {
    if (!user) return;
    for (const item of items) {
      if (item.estimate_status !== "failed") continue;
      const row: MealItem = { ...item, estimate_status: "pending" };
      setMeals((old) =>
        old.map((m) => ({ ...m, meal_items: m.meal_items.map((i) => (i.id === row.id ? row : i)) })),
      );
      await enqueue({ userId: user.id, table: "meal_items", kind: "upsert", payload: { ...row } });
    }
  };

  /** Re-reads the meals (pull to refresh): the way out of a missed estimate. */
  return { todayKey, todays, registrations, register, undo, retry, refresh };
}
