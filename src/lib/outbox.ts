import AsyncStorage from "@react-native-async-storage/async-storage";
import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { newId } from "@/src/lib/ids";
import { queryClient } from "@/src/lib/query-client";
import { qkPrefixes } from "@/src/lib/query-keys";
import { supabase } from "@/src/utils/supabase";

// Offline write queue: every data mutation appends a full-row op here and
// applies it to the query cache optimistically. Online, the queue drains
// immediately; offline, it survives restarts in AsyncStorage and drains on
// reconnect. Strict FIFO keeps parent inserts ahead of their children.

export type OutboxTable =
  | "profiles"
  | "meals"
  | "meal_items"
  | "routines"
  | "routine_exercises"
  | "workout_logs"
  | "program_exercise_completions"
  | "workout_set_logs"
  | "supplement_intake_logs";

export type OutboxOp = {
  opId: string;
  userId: string;
  table: OutboxTable;
  kind: "insert" | "upsert" | "delete";
  // Full row for insert/upsert (client-generated id); { id } for delete.
  payload: Record<string, unknown>;
  createdAt: number;
};

export type FlushResult = "synced" | "dropped" | "paused";

const STORAGE_KEY = "hokage-outbox-v1";

let queue: OutboxOp[] = [];
let hydration: Promise<void> | null = null;
let flushing: Promise<void> | null = null;

const countListeners = new Set<() => void>();
const resultListeners = new Set<(result: FlushResult) => void>();

function notifyCount() {
  countListeners.forEach((cb) => cb());
}

function notifyResult(result: FlushResult) {
  resultListeners.forEach((cb) => cb(result));
}

function ready(): Promise<void> {
  if (!hydration) {
    hydration = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) queue = JSON.parse(raw) as OutboxOp[];
      })
      .catch(() => {})
      .then(() => notifyCount());
  }
  return hydration;
}

async function save() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {}
  notifyCount();
}

// Removal by opId, not shift(): enqueue's delete-compaction can splice the
// queue while an op is mid-flight.
function removeOp(opId: string) {
  queue = queue.filter((q) => q.opId !== opId);
}

export async function enqueue(
  op: Omit<OutboxOp, "opId" | "createdAt">,
): Promise<void> {
  await ready();

  if (op.kind === "delete") {
    const id = op.payload.id;
    // Drop queued ops for this row and its queued children (they would
    // FK-fail once the parent delete lands). The delete itself still goes in:
    // if a crash hit between server insert and queue removal the row exists
    // server-side, and deleting a nonexistent row is a harmless no-op.
    queue = queue.filter(
      (q) =>
        q.userId !== op.userId ||
        (q.payload.id !== id &&
          q.payload.meal_id !== id &&
          q.payload.routine_id !== id),
    );
  }

  if (op.kind === "upsert" && op.table === "profiles") {
    // Consecutive profile edits collapse into one op
    const prev = queue.find(
      (q) =>
        q.userId === op.userId &&
        q.table === "profiles" &&
        q.kind === "upsert" &&
        q.payload.id === op.payload.id,
    );
    if (prev) {
      prev.payload = { ...prev.payload, ...op.payload };
      await save();
      void flushOutbox();
      return;
    }
  }

  queue.push({ ...op, opId: newId(), createdAt: Date.now() });
  await save();
  void flushOutbox();
}

export function flushOutbox(): Promise<void> {
  if (flushing) return flushing;
  flushing = doFlush()
    .catch(() => {})
    .finally(() => {
      flushing = null;
    });
  return flushing;
}

async function doFlush(): Promise<void> {
  await ready();
  if (queue.length === 0 || !onlineManager.isOnline()) return;
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return;

  let processed = 0;
  let dropped = false;
  while (queue.length > 0) {
    const op = queue[0];
    if (op.userId !== uid) {
      // Op from a previously signed-in account; signOut clears these, but
      // never replay them under the wrong session.
      removeOp(op.opId);
      await save();
      continue;
    }
    try {
      await execute(op);
    } catch (e) {
      if (isTransientError(e)) {
        if (processed > 0) notifyResult("paused");
        return; // stop FIFO, keep order, retry on next trigger
      }
      // Permanent error (RLS, constraint): drop the poison op so it can't
      // block the queue forever; the end-of-flush invalidation restores
      // server truth in the cache.
      dropped = true;
      console.warn(
        `[outbox] dropped ${op.kind} on ${op.table}:`,
        (e as { message?: string })?.message ?? e,
      );
    }
    removeOp(op.opId);
    await save();
    processed++;
  }

  if (processed > 0) {
    for (const prefix of qkPrefixes) {
      queryClient.invalidateQueries({ queryKey: [...prefix] });
    }
    notifyResult(dropped ? "dropped" : "synced");
  }
}

async function execute(op: OutboxOp): Promise<void> {
  if (op.kind === "insert") {
    // ON CONFLICT DO NOTHING: replay-safe if a crash hit mid-flush, and needs
    // no UPDATE policy on content tables.
    const { error } = await supabase
      .from(op.table)
      .upsert(op.payload, { ignoreDuplicates: true });
    if (error) throw error;
  } else if (op.kind === "upsert") {
    const { error } = await supabase.from(op.table).upsert(op.payload);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from(op.table)
      .delete()
      .eq("id", op.payload.id as string);
    if (error) throw error;
  }
}

// PostgREST errors carry a code ("23505", "PGRST116", ...); fetch failures
// surface with an empty one. JWT errors (PGRST30x) heal once the token
// refreshes, so they also retry rather than drop.
function isTransientError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return !code || code.startsWith("PGRST3");
}

export async function clearOutbox(): Promise<void> {
  await ready();
  queue = [];
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {}
  notifyCount();
}

// Pending ops for the overlay; awaits hydration so an early refetch can't
// observe an empty queue that actually has persisted ops.
export async function getPendingOps(userId: string): Promise<OutboxOp[]> {
  await ready();
  return queue.filter((op) => op.userId === userId);
}

export function subscribeFlushResult(
  cb: (result: FlushResult) => void,
): () => void {
  resultListeners.add(cb);
  return () => resultListeners.delete(cb);
}

export function usePendingCount(): number {
  return useSyncExternalStore(
    (onChange) => {
      countListeners.add(onChange);
      return () => countListeners.delete(onChange);
    },
    () => queue.length,
    () => 0,
  );
}

// Drain whenever connectivity comes back
onlineManager.subscribe((online) => {
  if (online) void flushOutbox();
});

void ready();
