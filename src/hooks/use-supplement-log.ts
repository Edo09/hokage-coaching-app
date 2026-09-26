import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAuth } from "@/src/hooks/use-auth";
import { newId } from "@/src/lib/ids";
import { enqueue } from "@/src/lib/outbox";
import { qk } from "@/src/lib/query-keys";
import type { SupplementIntakeLog } from "@/src/types/database";
import { toDateKey } from "@/src/utils/dates";
import { supabase } from "@/src/utils/supabase";

// Daily supplement check-off. Offline-first via the outbox, same pattern as
// program completions (use-program-logging.ts). Ticks are keyed by supplement
// name, so they survive the coach re-saving the stack mid-day.

async function fetchDay(userId: string, dateKey: string): Promise<SupplementIntakeLog[]> {
  const { data, error } = await supabase
    .from("supplement_intake_logs")
    .select("*")
    .eq("user_id", userId)
    .eq("taken_on", dateKey);
  // Missing table (migration not applied) degrades to "nothing ticked".
  if (error) return [];
  return data as SupplementIntakeLog[];
}

export function useSupplementLog(dateKey: string = toDateKey()) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = qk.supplementLog(user?.id, dateKey);

  const { data: logs = [] } = useQuery({
    queryKey: key,
    queryFn: () => fetchDay(user!.id, dateKey),
    enabled: !!user,
  });

  const logOf = useCallback(
    (name: string) => logs.find((l) => l.supplement_name === name) ?? null,
    [logs],
  );

  const isTaken = useCallback((name: string) => logOf(name) != null, [logOf]);

  const setTaken = useCallback(
    async (name: string, taken: boolean) => {
      const existing = logOf(name);
      if (taken && existing == null) {
        const row: SupplementIntakeLog = {
          id: newId(),
          user_id: user!.id,
          taken_on: dateKey,
          supplement_name: name,
          created_at: new Date().toISOString(),
        };
        queryClient.setQueryData<SupplementIntakeLog[]>(key, (old = []) => [...old, row]);
        await enqueue({ userId: user!.id, table: "supplement_intake_logs", kind: "insert", payload: row });
      } else if (!taken && existing != null) {
        queryClient.setQueryData<SupplementIntakeLog[]>(key, (old = []) =>
          old.filter((l) => l.id !== existing.id),
        );
        await enqueue({
          userId: user!.id,
          table: "supplement_intake_logs",
          kind: "delete",
          payload: { id: existing.id },
        });
      }
    },
    [dateKey, key, logOf, queryClient, user],
  );

  return { isTaken, setTaken };
}
