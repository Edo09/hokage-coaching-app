import { useAuth } from "@/src/hooks/use-auth";
import i18n from "@/src/i18n";
import { enqueue } from "@/src/lib/outbox";
import { overlayMeals } from "@/src/lib/outbox-overlay";
import { newId } from "@/src/lib/ids";
import { qk } from "@/src/lib/query-keys";
import { removeMealPhoto } from "@/src/services/meal-photos";
import type {
    Meal,
    MealInsert,
    MealItem,
    MealItemInsert,
    MealType,
    MealWithItems,
} from "@/src/types/database";
import { toDateKey } from "@/src/utils/dates";
import { supabase } from "@/src/utils/supabase";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

// Items ride along with the list so the whole meals tab (diary) is a single
// persisted query that works offline.
async function fetchMeals(userId: string): Promise<MealWithItems[]> {
  // Explicit user filter on top of RLS: the coach role can read every
  // client's rows, so without it a coach signing into the app would see
  // all clients' data merged into their own diary.
  const { data, error } = await supabase
    .from("meals")
    .select("*, meal_items(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return overlayMeals(userId, data as MealWithItems[]);
}

// Dedupes concurrent slot-container creation (e.g. rapid double-tap on add)
const inflightSlotCreates = new Map<string, Promise<Meal>>();

export function useMeals() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const listKey = qk.meals(user?.id);

  const {
    data: meals = [],
    isPending: loading,
    isError: error,
    isRefetching: refreshing,
    refetch,
  } = useQuery({
    queryKey: listKey,
    queryFn: () => fetchMeals(user!.id),
    enabled: !!user,
  });

  const todaysMeals = useMemo(
    () => meals.filter((m) => m.date === toDateKey()),
    [meals],
  );

  // All mutations are local-first: build the full row (client id), apply it
  // to the cache, queue the op. The outbox syncs and then invalidates.
  const createMealMutation = useMutation({
    mutationFn: async (data: MealInsert) => {
      const now = new Date().toISOString();
      const meal: Meal = {
        id: newId(),
        user_id: user!.id,
        name: data.name,
        meal_type: data.meal_type,
        date: data.date ?? toDateKey(),
        assigned_by: null,
        created_at: now,
        updated_at: now,
      };
      queryClient.setQueryData<MealWithItems[]>(listKey, (old = []) => [
        { ...meal, meal_items: [] },
        ...old,
      ]);
      await enqueue({
        userId: user!.id,
        table: "meals",
        kind: "insert",
        payload: meal,
      });
      return meal;
    },
  });

  const deleteMealMutation = useMutation({
    mutationFn: async (id: string) => {
      queryClient.setQueryData<MealWithItems[]>(listKey, (old = []) =>
        old.filter((m) => m.id !== id),
      );
      await enqueue({
        userId: user!.id,
        table: "meals",
        kind: "delete",
        payload: { id },
      });
    },
  });

  const addMealItemMutation = useMutation({
    mutationFn: async (data: MealItemInsert) => {
      const item: MealItem = {
        id: newId(),
        meal_id: data.meal_id,
        user_id: user!.id,
        name: data.name,
        calories: data.calories ?? 0,
        protein_g: data.protein_g ?? 0,
        carbs_g: data.carbs_g ?? 0,
        fat_g: data.fat_g ?? 0,
        portion: data.portion ?? null,
        photo_path: data.photo_path ?? null,
        // Carries through to the outbox payload, so an item registered from a
        // prescribed option keeps its adherence link even when queued offline.
        plan_option_id: data.plan_option_id ?? null,
        created_at: new Date().toISOString(),
      };
      queryClient.setQueryData<MealWithItems[]>(listKey, (old = []) =>
        old.map((m) =>
          m.id === item.meal_id
            ? { ...m, meal_items: [...m.meal_items, item] }
            : m,
        ),
      );
      await enqueue({
        userId: user!.id,
        table: "meal_items",
        kind: "insert",
        payload: item,
      });
      return item;
    },
  });

  const removeMealItemMutation = useMutation({
    mutationFn: async (id: string) => {
      queryClient.setQueryData<MealWithItems[]>(listKey, (old = []) =>
        old.map((m) => ({
          ...m,
          meal_items: m.meal_items.filter((i) => i.id !== id),
        })),
      );
      await enqueue({
        userId: user!.id,
        table: "meal_items",
        kind: "delete",
        payload: { id },
      });
    },
  });

  // Slot containers are invisible plumbing: the diary is (date, meal_type) →
  // items. Reuse the oldest existing container (legacy data may have several
  // per slot); create one lazily otherwise. The cache lookup is synchronous
  // over optimistic state, so this works offline.
  // Coach-assigned containers are never reused: an item that lands in one is
  // flagged read-only by the diary, locking the user out of their own entry.
  const getOrCreateSlotMeal = async (
    date: string,
    mealType: MealType,
  ): Promise<Meal> => {
    const cached = queryClient.getQueryData<MealWithItems[]>(listKey) ?? [];
    const existing = cached
      .filter(
        (m) =>
          m.date === date && m.meal_type === mealType && m.assigned_by == null,
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    if (existing != null) return existing;

    const key = `${user!.id}:${date}:${mealType}`;
    const pending = inflightSlotCreates.get(key);
    if (pending != null) return pending;
    // Container name is cosmetic only (never rendered by the diary)
    const create = createMealMutation
      .mutateAsync({ name: i18n.t(`meals.${mealType}`), meal_type: mealType, date })
      .finally(() => inflightSlotCreates.delete(key));
    inflightSlotCreates.set(key, create);
    return create;
  };

  // Diary edit: update an item's properties in place, optionally moving it
  // to another slot (re-parents it into that slot's container). Syncs as an
  // upsert of the full row — works whether or not the original insert has
  // reached the server yet.
  const updateDiaryItem = async (
    itemId: string,
    updates: Partial<
      Pick<MealItem, "name" | "calories" | "protein_g" | "carbs_g" | "fat_g" | "portion">
    >,
    newMealType?: MealType,
  ) => {
    const cached = queryClient.getQueryData<MealWithItems[]>(listKey) ?? [];
    const parent = cached.find((m) =>
      m.meal_items.some((i) => i.id === itemId),
    );
    const item = parent?.meal_items.find((i) => i.id === itemId);
    if (parent == null || item == null) throw new Error("Item not found");

    let targetMealId = parent.id;
    if (newMealType != null && newMealType !== parent.meal_type) {
      targetMealId = (await getOrCreateSlotMeal(parent.date, newMealType)).id;
    }
    const updated: MealItem = { ...item, ...updates, meal_id: targetMealId };

    queryClient.setQueryData<MealWithItems[]>(listKey, (old = []) =>
      old.map((m) => {
        const without = m.meal_items.filter((i) => i.id !== itemId);
        if (m.id === targetMealId) return { ...m, meal_items: [...without, updated] };
        if (without.length !== m.meal_items.length) return { ...m, meal_items: without };
        return m;
      }),
    );

    await enqueue({
      userId: user!.id,
      table: "meal_items",
      kind: "upsert",
      payload: updated,
    });

    // Moving the only item out of a container leaves it empty — clean it up
    if (targetMealId !== parent.id && parent.meal_items.length <= 1) {
      await deleteMealMutation.mutateAsync(parent.id);
    }
  };

  // Diary removal: dropping the last item also deletes the (invisible)
  // container so the DB stays tidy. Parent must be read BEFORE the item
  // mutation rewrites the cache.
  const removeDiaryItem = async (itemId: string) => {
    const cached = queryClient.getQueryData<MealWithItems[]>(listKey) ?? [];
    const parent = cached.find((m) =>
      m.meal_items.some((i) => i.id === itemId),
    );
    const photoPath = parent?.meal_items.find((i) => i.id === itemId)?.photo_path;
    await removeMealItemMutation.mutateAsync(itemId);
    if (parent != null && parent.meal_items.length <= 1) {
      await deleteMealMutation.mutateAsync(parent.id);
    }
    if (photoPath != null) removeMealPhoto(photoPath);
  };

  return {
    meals,
    loading,
    error,
    refreshing,
    todaysMeals,
    createMeal: createMealMutation.mutateAsync,
    deleteMeal: deleteMealMutation.mutateAsync,
    addMealItem: addMealItemMutation.mutateAsync,
    removeMealItem: removeMealItemMutation.mutateAsync,
    getOrCreateSlotMeal,
    updateDiaryItem,
    removeDiaryItem,
    refresh: refetch,
  };
}
