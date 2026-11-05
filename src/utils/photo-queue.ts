import type { OutboxOp } from "@/src/lib/outbox";
import type { Meal, MealItem } from "@/src/types/database";

// The pure half of the photo queue (src/lib/photo-queue.ts): one job per
// registration, when to give up on an upload, and the outbox ops a job turns
// into once its photo is stored. No React, no storage, so `npm test` runs it.

/** A registration waiting for its photo. The row reaches the outbox only once
 *  the photo is in storage (or the upload is given up), so the server
 *  estimates it once, with the photo. */
export type PhotoJob = {
  registrationId: string;
  userId: string;
  /** The picked photo, copied where the system won't purge it. */
  localUri: string;
  /** Chosen when queued and kept across retries, so a retry that finds the
   *  file already stored counts as done. */
  storagePath: string;
  mimeType: string;
  container: Meal;
  row: MealItem;
  tries: number;
};

/** Uploads that fail while online are given up after this many tries; the
 *  row is then saved without its photo. */
export const MAX_UPLOAD_TRIES = 3;

/** Adds a job, replacing any job for the same registration. */
export function putJob(jobs: PhotoJob[], job: PhotoJob): PhotoJob[] {
  return [...jobs.filter((j) => j.registrationId !== job.registrationId), job];
}

export function dropJob(jobs: PhotoJob[], registrationId: string): PhotoJob[] {
  return jobs.filter((j) => j.registrationId !== registrationId);
}

export function afterFailedUpload(job: PhotoJob): { job: PhotoJob; giveUp: boolean } {
  const next = { ...job, tries: job.tries + 1 };
  return { job: next, giveUp: next.tries >= MAX_UPLOAD_TRIES };
}

/** Storage refuses a second upload to the same path (no upsert: the bucket has
 *  no UPDATE policy); for a retry that means the first one got through. */
export function isDuplicateUpload(e: unknown): boolean {
  if (e == null || typeof e !== "object") return false;
  const o = e as { statusCode?: unknown; status?: unknown; message?: unknown };
  if (o.statusCode === "409" || o.status === 409) return true;
  return typeof o.message === "string" && /already exists/i.test(o.message);
}

/** The ops a job becomes: its container (insert, which ignores an existing
 *  one), then its row (upsert), with the stored photo or none. */
export function jobAsOps(
  job: PhotoJob,
  photoPath: string | null = job.storagePath,
): Omit<OutboxOp, "opId" | "createdAt">[] {
  return [
    { userId: job.userId, table: "meals", kind: "insert", payload: { ...job.container } },
    { userId: job.userId, table: "meal_items", kind: "upsert", payload: { ...job.row, photo_path: photoPath } },
  ];
}
