import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/src/hooks/use-auth";
import { useMealRegistrations } from "@/src/hooks/use-meal-registrations";
import { getPendingOps } from "@/src/lib/outbox";
import { hasQueuedPhoto } from "@/src/lib/photo-queue";
import { qk } from "@/src/lib/query-keys";
import type { MealWithItems } from "@/src/types/database";
import { normalizeMealItem, patchItemInCache, pendingRecheckIds } from "@/src/utils/meal-cache";
import { mealsOnDate } from "@/src/utils/meal-registration";
import { supabase } from "@/src/utils/supabase";

// Brings the server's estimates into the app while it is open: Realtime on
// the client's own meal_items rows (migration 20261105120000 put the table on
// supabase_realtime), plus a light re-read of today's pending rows every 10 s
// in case an event is missed. Both patch the one row in the persisted meals
// cache — invalidating it would download the whole meal history on every
// estimate. A row with a write still queued (outbox or photo queue) is left
// alone: the refetch after that write syncs brings it back. Mounted once, in
// the tabs layout.

const RECHECK_MS = 10_000;
let channelSeq = 0;

/** Applies a row from the server unless a local write for it is still queued. */
async function applyRow(queryClient: QueryClient, uid: string, raw: Record<string, unknown>): Promise<void> {
  const row = normalizeMealItem(raw);
  if (hasQueuedPhoto(row.id)) return;
  const pending = await getPendingOps(uid);
  if (pending.some((op) => op.payload.id === row.id)) return;
  const key = qk.meals(uid);
  const patched = patchItemInCache(queryClient.getQueryData<MealWithItems[]>(key) ?? [], row);
  if (patched == null) void queryClient.invalidateQueries({ queryKey: key });
  else queryClient.setQueryData(key, patched);
}

export function useMealEstimateSync(): void {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { todayKey, todays } = useMealRegistrations();
  const uid = user?.id;
  // Any eaten registration still without its estimate keeps the re-read
  // running; which rows are due is decided at each tick.
  const waiting = todays.some((m) =>
    m.meal_items.some((i) => (i.kind === "plan" || i.kind === "other") && i.estimate_status === "pending"),
  );

  useEffect(() => {
    if (uid == null) return;
    channelSeq += 1;
    const channel = supabase
      .channel(`estimates:meal_items:${channelSeq}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meal_items", filter: `user_id=eq.${uid}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            void queryClient.invalidateQueries({ queryKey: qk.meals(uid) });
          } else {
            void applyRow(queryClient, uid, payload.new as Record<string, unknown>);
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [uid, queryClient]);

  useEffect(() => {
    if (uid == null || !waiting) return;
    const timer = setInterval(() => {
      if (AppState.currentState !== "active") return;
      // From the cache at each tick: a row whose lease runs out comes back in
      // without waiting for a render, and a long quota wait stays out.
      const cached = queryClient.getQueryData<MealWithItems[]>(qk.meals(uid)) ?? [];
      const ids = pendingRecheckIds(mealsOnDate(cached, todayKey), new Date());
      if (ids.length === 0) return;
      void supabase
        .from("meal_items")
        .select("*")
        .in("id", ids)
        .then(({ data }) => {
          for (const raw of data ?? []) void applyRow(queryClient, uid, raw as Record<string, unknown>);
        });
    }, RECHECK_MS);
    return () => clearInterval(timer);
  }, [uid, waiting, todayKey, queryClient]);
}
