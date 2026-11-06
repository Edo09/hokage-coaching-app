// One estimate, end to end: read the registration, take the client's quota,
// ask the model (with the photo when there is one), and write back only while
// the row is still the version the call was sent for. Every way out either
// finishes the estimate or hands it back to the database's retry schedule
// (fail_meal_estimate / defer_meal_estimate); a call that dies before either
// is re-sent by the cron once its lease runs out. A failure also records why
// in meal_estimate_errors, where a query can read it (these logs only show in
// the dashboard).

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import { completeJSONWithPhoto, IMAGE_TYPES, type PhotoInput } from '../_shared/complete-json-photo.ts';
import {
  acceptCorrection,
  buildEstimatePrompt,
  type EstimateKind,
  failureText,
  parseEstimate,
  photoPathAllowed,
} from '../_shared/meal-estimate.ts';

/** The most of a photo this function reads; the app uploads at quality 0.5. */
const MAX_PHOTO_BYTES = 5_000_000;

type Registration = {
  id: string;
  user_id: string;
  kind: string | null;
  name: string;
  original_text: string | null;
  photo_path: string | null;
  estimate_status: string | null;
  estimate_version: number | null;
};

async function rpcLogged(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await db.rpc(fn, args);
  if (error) console.warn(`${fn} failed:`, error.message);
}

/** Why this call failed, in meal_estimate_errors (migration
 *  20261106120000_meal_estimate_errors.sql). */
async function recordFailure(db: SupabaseClient, id: string, version: number, e: unknown): Promise<void> {
  await rpcLogged(db, 'log_meal_estimate_error', { p_id: id, p_version: version, p_error: failureText(e) });
}

/** The photo, when it is the client's own, an image and not too big; anything
 *  else is ignored like a photo that isn't food, and the text decides. */
async function readPhoto(db: SupabaseClient, userId: string, path: string | null): Promise<PhotoInput | undefined> {
  if (!path || !photoPathAllowed(userId, path)) return undefined;
  try {
    const { data, error } = await db.storage.from('meal-photos').download(path);
    if (error || !data) return undefined;
    const declared = data.type === 'image/jpg' ? 'image/jpeg' : data.type;
    const mimeType = declared || (path.endsWith('.png') ? 'image/png' : 'image/jpeg');
    if (data.size > MAX_PHOTO_BYTES || !IMAGE_TYPES.has(mimeType)) return undefined;
    return { base64: encodeBase64(new Uint8Array(await data.arrayBuffer())), mimeType };
  } catch (e) {
    console.warn('photo not read:', e);
    return undefined;
  }
}

export async function estimateRegistration(db: SupabaseClient, id: string, version: number): Promise<void> {
  const { data: row, error } = await db
    .from('meal_items')
    .select('id, user_id, kind, name, original_text, photo_path, estimate_status, estimate_version')
    .eq('id', id)
    .maybeSingle<Registration>();
  // Nothing taken yet: the lease runs out and the cron sends it again.
  if (error) {
    await recordFailure(db, id, version, error);
    throw error;
  }
  if (!row || row.estimate_status !== 'pending' || row.estimate_version !== version) return;
  if (row.kind !== 'plan' && row.kind !== 'other') return;
  const kind = row.kind as EstimateKind;

  const { data: allowed, error: quotaError } = await db.rpc('take_ai_quota_for', { p_user_id: row.user_id });
  if (quotaError) {
    console.error('take_ai_quota_for failed (migration applied?):', quotaError.message);
    await recordFailure(db, id, version, quotaError);
    await rpcLogged(db, 'fail_meal_estimate', { p_id: id, p_version: version });
    return;
  }
  if (allowed !== true) {
    await rpcLogged(db, 'defer_meal_estimate', { p_id: id, p_version: version });
    return;
  }

  try {
    if (Deno.env.get('ESTIMATE_FAIL_USER_ID') === row.user_id) throw new Error('test failure');

    const text = kind === 'other' ? (row.original_text ?? row.name) : row.name;
    const image = await readPhoto(db, row.user_id, row.photo_path);
    const { system, user } = buildEstimatePrompt({ kind, text, hasPhoto: image != null });
    const { json: raw, provider } = await completeJSONWithPhoto({ system, user, image, temperature: 0.1 });
    const r = parseEstimate(raw, kind);
    if (!r) throw new Error(`unusable answer from ${provider}`);

    const name = kind === 'other' ? (r.corrected != null && acceptCorrection(text, r.corrected) ? r.corrected : text) : null;
    const { error: finishError } = await db.rpc('finish_meal_estimate', {
      p_id: id,
      p_version: version,
      p_calories: r.calories,
      p_protein_g: r.protein_g,
      p_carbs_g: r.carbs_g,
      p_fat_g: r.fat_g,
      p_name: name,
    });
    if (finishError) throw finishError;
  } catch (e) {
    console.warn(`estimate ${id} failed:`, e);
    await recordFailure(db, id, version, e);
    await rpcLogged(db, 'refund_ai_quota_for', { p_user_id: row.user_id });
    await rpcLogged(db, 'fail_meal_estimate', { p_id: id, p_version: version });
  }
}
