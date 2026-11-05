import AsyncStorage from "@react-native-async-storage/async-storage";
import { onlineManager } from "@tanstack/react-query";
import { Directory, File, Paths } from "expo-file-system";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

import { enqueue, type OutboxOp } from "@/src/lib/outbox";
import { queryClient } from "@/src/lib/query-client";
import { qk } from "@/src/lib/query-keys";
import { mealPhotoUrl, uploadMealPhotoBytes } from "@/src/services/meal-photos";
import type { Meal, MealItem, MealWithItems } from "@/src/types/database";
import { afterFailedUpload, dropJob, jobAsOps, type PhotoJob, putJob } from "@/src/utils/photo-queue";

// Registrations waiting for their photo. A registration with a photo reaches
// the outbox only once the photo is in storage, so the server estimates it
// once, with the photo; the sheet still closes at once (the card shows the
// registration from the cache and the overlay). Kept apart from the outbox,
// which is strictly first in, first out: a multi-MB upload on a weak
// connection must never hold back other writes. The picked file is copied
// into the app's documents, and the queue (metadata only — AsyncStorage on
// Android is capped at 6 MB) survives a restart. On web there is nothing to
// copy to: the queue lives in memory for the session.

const STORAGE_KEY = "hokage-photo-queue-v1";
const isWeb = Platform.OS === "web";
const RETRY_MS = 30_000;

let jobs: PhotoJob[] = [];
let hydrated: Promise<void> | null = null;
let running: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let setUp = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function ready(): Promise<void> {
  hydrated ??= isWeb
    ? Promise.resolve()
    : AsyncStorage.getItem(STORAGE_KEY)
        .then((raw) => {
          if (raw == null) return;
          const saved: unknown = JSON.parse(raw);
          if (Array.isArray(saved)) jobs = saved as PhotoJob[];
        })
        .catch(() => {});
  return hydrated;
}

async function save(): Promise<void> {
  if (isWeb) return;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    // Non-fatal: the job still runs this session
  }
}

function deleteLocal(job: PhotoJob) {
  if (isWeb) return;
  try {
    const file = new File(job.localUri);
    if (file.exists) file.delete();
  } catch {
    // An orphaned copy in the app's documents is harmless
  }
}

async function copyToQueue(sourceUri: string, registrationId: string, mimeType: string): Promise<string> {
  if (isWeb) return sourceUri;
  const dir = new Directory(Paths.document, "meal-photo-queue");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const ext = mimeType === "image/png" ? "png" : "jpg";
  const dest = new File(dir, `${registrationId}-${Date.now()}.${ext}`);
  await new File(sourceUri).copy(dest);
  return dest.uri;
}

/** Queue a registration behind its photo. Replaces any job for the same
 *  registration (a new photo picked before the first one uploaded). */
export async function queuePhotoJob(i: {
  userId: string;
  registrationId: string;
  sourceUri: string;
  mimeType: string;
  storagePath: string;
  container: Meal;
  row: MealItem;
}): Promise<void> {
  await ready();
  const localUri = await copyToQueue(i.sourceUri, i.registrationId, i.mimeType);
  const old = jobs.find((j) => j.registrationId === i.registrationId);
  jobs = putJob(jobs, {
    registrationId: i.registrationId,
    userId: i.userId,
    localUri,
    storagePath: i.storagePath,
    mimeType: i.mimeType,
    container: i.container,
    row: i.row,
    tries: 0,
  });
  if (old != null && old.localUri !== localUri) deleteLocal(old);
  emit();
  await save();
  void processPhotoQueue();
}

/** A change that keeps the queued photo: the job hands over the new row. */
export async function updateQueuedRow(registrationId: string, row: MealItem): Promise<boolean> {
  await ready();
  const job = jobs.find((j) => j.registrationId === registrationId);
  if (job == null) return false;
  jobs = putJob(jobs, { ...job, row });
  emit();
  await save();
  return true;
}

/** Undo, «No la comí» or a removed photo: nothing of this job may come back. */
export async function cancelPhotoJob(registrationId: string): Promise<void> {
  await ready();
  const job = jobs.find((j) => j.registrationId === registrationId);
  if (job == null) return;
  jobs = dropJob(jobs, registrationId);
  deleteLocal(job);
  emit();
  await save();
}

export function hasQueuedPhoto(registrationId: string): boolean {
  return jobs.some((j) => j.registrationId === registrationId);
}

/** The photo to show for a registration: the queued local copy while it
 *  uploads, then the stored one. */
export function useRegistrationPhotoUri(item: MealItem | null): string | null {
  const id = item?.id ?? null;
  const queued = useSyncExternalStore(
    subscribe,
    () => (id == null ? null : (jobs.find((j) => j.registrationId === id)?.localUri ?? null)),
    () => null,
  );
  if (queued != null) return queued;
  return item?.photo_path ? mealPhotoUrl(item.photo_path) : null;
}

/** The queued registrations as outbox-shaped ops, so a refetch while a photo
 *  uploads still shows them (outbox-overlay.ts). */
export async function getPendingPhotoOps(userId: string): Promise<OutboxOp[]> {
  await ready();
  return jobs
    .filter((j) => j.userId === userId)
    .flatMap((j) => jobAsOps(j).map((op, n) => ({ ...op, opId: `photo:${j.registrationId}:${n}`, createdAt: 0 })));
}

async function readBytes(job: PhotoJob): Promise<ArrayBuffer | null> {
  try {
    if (isWeb) return await (await fetch(job.localUri)).arrayBuffer();
    const file = new File(job.localUri);
    if (!file.exists) return null;
    const bytes = await file.bytes();
    return bytes.buffer as ArrayBuffer;
  } catch {
    return null;
  }
}

/** Hand the row to the outbox (with its photo, or without when the upload was
 *  given up), then forget the job. Enqueued before the job is dropped, so a
 *  refetch in between still finds the row in one of the two. */
async function handOver(job: PhotoJob, photoPath: string | null): Promise<void> {
  for (const op of jobAsOps(job, photoPath)) await enqueue(op);
  if (photoPath == null) {
    queryClient.setQueryData<MealWithItems[]>(qk.meals(job.userId), (old) =>
      old?.map((m) => ({
        ...m,
        meal_items: m.meal_items.map((i) => (i.id === job.registrationId ? { ...i, photo_path: null } : i)),
      })),
    );
  }
  jobs = dropJob(jobs, job.registrationId);
  deleteLocal(job);
  emit();
  await save();
}

async function work(): Promise<void> {
  await ready();
  while (jobs.length > 0 && onlineManager.isOnline()) {
    const job = jobs[0];
    const bytes = await readBytes(job);
    const outcome = bytes == null ? "missing" : await uploadMealPhotoBytes(job.storagePath, bytes, job.mimeType);

    // Cancelled or replaced while uploading: what it uploaded is orphaned,
    // and the loop moves on to whatever is queued now.
    const current = jobs.find((j) => j.registrationId === job.registrationId);
    if (current == null || current.localUri !== job.localUri) continue;

    if (outcome === "stored" || outcome === "duplicate") {
      await handOver(current, current.storagePath);
    } else if (outcome === "missing") {
      await handOver(current, null);
    } else {
      if (!onlineManager.isOnline()) break;
      const { job: next, giveUp } = afterFailedUpload(current);
      if (giveUp) {
        await handOver(current, null);
      } else {
        jobs = putJob(jobs, next);
        await save();
        retryTimer ??= setTimeout(() => {
          retryTimer = null;
          void processPhotoQueue();
        }, RETRY_MS);
        break;
      }
    }
  }
}

/** Upload what is queued, one job at a time. Single-flight: concurrent calls
 *  share the run in progress. */
export function processPhotoQueue(): Promise<void> {
  running ??= work().finally(() => {
    running = null;
  });
  return running;
}

/** Once, at app start: restore the queue and resume it whenever the device is
 *  back online. app/_layout.tsx also resumes it on foreground and after the
 *  cache restore. */
export function setupPhotoQueue(): void {
  if (setUp) return;
  setUp = true;
  void ready().then(() => {
    emit();
    void processPhotoQueue();
  });
  onlineManager.subscribe((online) => {
    if (online) void processPhotoQueue();
  });
}

/** Sign-out: nothing of the previous account's queue may upload or show. */
export async function clearPhotoQueue(): Promise<void> {
  await ready();
  for (const job of jobs) deleteLocal(job);
  jobs = [];
  emit();
  if (isWeb) return;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal
  }
}
