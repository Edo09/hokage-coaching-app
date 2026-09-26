// Coach Admin Panel — drafts a training program from the coach's prompt with
// an LLM. Two modes, one call:
//   - new:  { prompt }                   → a whole program from scratch
//   - edit: { prompt, current }          → `current` (the builder's draft, in
//                                          the shape described in prompt.ts)
//                                          with the requested changes applied
// Either can carry { client_id, include_notes } to fit the program to a client
// (profile fields; the coach's private note only when include_notes is true).
//
// This function only DRAFTS. It writes nothing: the panel loads the result
// into its builder, the coach reviews it, and saving goes through the normal
// save_coach_program RPC and its checks. Exercise names are forced onto the
// shared catalog here (the panel drops any that still don't resolve).
//
// Deploy, and give it the provider keys (see llm.ts) and ALLOWED_ORIGINS
// (see ../_shared/cors.ts):
//   supabase functions deploy generate-program --project-ref rzgwkwxskrovxnnymxqo

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { callerClient, verifyCoach } from '../_shared/coach.ts';
import { json, withCors } from '../_shared/cors.ts';
import { completeJSON } from './llm.ts';
import { PROGRAM_SCHEMA, REPAIR_PROMPT, REPAIR_SCHEMA, SYSTEM_PROMPT } from './prompt.ts';

const MAX_PROMPT_CHARS = 2000;
const MAX_CURRENT_CHARS = 200_000;
const MAX_NOTES_CHARS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// profiles.available_days stores "Mon".."Sun"; programs use full lowercase names.
const SHORT_TO_DAY: Record<string, string> = {
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
  sun: 'sunday',
};

type Obj = Record<string, unknown>;
interface CatalogRow {
  name: string;
  bodyPart: string;
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Case, accents and punctuation don't make a different exercise. */
const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

Deno.serve(withCors(async (req) => {
  try {
    const caller = await verifyCoach(req);
    if (caller === 'unauthenticated') return json({ error: 'unauthenticated' }, 401);
    if (caller === 'forbidden') return json({ error: 'forbidden' }, 403);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Solicitud inválida.' }, 400);
    }
    if (!isObj(body)) return json({ error: 'Solicitud inválida.' }, 400);

    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) return json({ error: 'Escribe cómo quieres el programa.' }, 400);
    if (prompt.length > MAX_PROMPT_CHARS) {
      return json({ error: `La instrucción es muy larga (máximo ${MAX_PROMPT_CHARS} caracteres).` }, 400);
    }
    const current = isObj(body.current) ? body.current : null;
    if (current && JSON.stringify(current).length > MAX_CURRENT_CHARS) {
      return json({ error: 'El programa es demasiado grande para editarlo con IA.' }, 400);
    }
    const clientId = typeof body.client_id === 'string' && UUID.test(body.client_id) ? body.client_id : null;
    const includeNotes = body.include_notes === true;

    const db = callerClient(req);
    const [catalog, client] = await Promise.all([
      loadCatalog(db),
      clientId ? loadClient(db, clientId, includeNotes) : Promise.resolve(null),
    ]);
    if (catalog.length === 0) return json({ error: 'El catálogo de ejercicios está vacío.' }, 500);

    const user = JSON.stringify({
      coach_request: prompt,
      ...(client?.profile ? { client: client.profile } : {}),
      ...(client?.notes ? { coach_notes: client.notes } : {}),
      ...(current ? { current_program: current } : {}),
      exercise_catalog: groupCatalog(catalog),
    });

    const started = Date.now();
    // Gemini 85 s + Groq 40 s + the name repair stays under the 150 s
    // wall-clock limit of the smallest Supabase plan.
    const { json: raw, provider } = await completeJSON(
      { system: SYSTEM_PROMPT, user, schema: PROGRAM_SCHEMA, timeoutMs: 85_000, maxOutputTokens: 32_768 },
      40_000,
    );
    const program = asProgram(raw);
    if (!program) {
      const detail = `${provider} answered without usable days (keys: ${isObj(raw) ? Object.keys(raw).join(', ') : typeof raw})`;
      console.error('generate-program failed:', detail);
      return json({ error: 'La IA no devolvió un programa válido. Intenta de nuevo.', detail }, 502);
    }

    const unresolved = await resolveNames(program, catalog, current, Date.now() - started < 120_000);
    return json({ program, unresolved, provider }, 200);
  } catch (e) {
    console.error('generate-program failed:', e);
    // `detail` is the providers' own error text (status + message, never a
    // key), so the panel can show the coach what actually went wrong.
    const detail = (e instanceof Error ? e.message : String(e)).slice(0, 800);
    return json({ error: friendlyError(detail), detail }, 502);
  }
}));

/** The usual failures, in words the coach can act on. */
function friendlyError(detail: string): string {
  if (/GEMINI_API_KEY is not set/.test(detail) && /GROQ_API_KEY is not set/.test(detail)) {
    return 'Faltan las claves de IA (GEMINI_API_KEY / GROQ_API_KEY) en los secretos de Supabase.';
  }
  if (/API key not valid|API_KEY_INVALID|invalid_api_key|Invalid API Key/i.test(detail)) {
    return 'Una clave de IA no es válida. Revisa GEMINI_API_KEY / GROQ_API_KEY en los secretos de Supabase.';
  }
  if (/\b429\b|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(detail)) {
    return 'Se alcanzó el límite de uso de la IA. Espera un minuto y vuelve a intentarlo.';
  }
  if (/timeout/i.test(detail)) {
    return 'La IA tardó demasiado en responder. Intenta de nuevo o pide un programa más corto.';
  }
  return 'No se pudo generar el programa. Intenta de nuevo en un momento.';
}

/* ---------------- context ---------------- */

async function loadCatalog(db: SupabaseClient): Promise<CatalogRow[]> {
  const { data, error } = await db.from('exercises').select('name, body_part:bodyparts(name)');
  if (error) throw error;
  return ((data ?? []) as unknown as { name: string; body_part: { name: string } | null }[]).map((r) => ({
    name: r.name.trim(),
    bodyPart: r.body_part?.name ?? 'other',
  }));
}

/** Catalog names grouped by body part — easier for the model to pick from. */
function groupCatalog(catalog: CatalogRow[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of catalog) (out[r.bodyPart] ??= []).push(r.name);
  for (const names of Object.values(out)) names.sort((a, b) => a.localeCompare(b, 'es'));
  return out;
}

/** Only what shapes a program. No name, email or contact details go to the
 *  model; the private note only when the coach opted in. */
async function loadClient(
  db: SupabaseClient,
  clientId: string,
  includeNotes: boolean,
): Promise<{ profile: Obj | null; notes: string | null }> {
  const { data: p } = await db
    .from('profiles')
    .select('age, sex, height_cm, weight_kg, activity_level, profession_type, days_per_week, session_duration, available_days, goal')
    .eq('id', clientId)
    .maybeSingle();

  let profile: Obj | null = null;
  if (p) {
    const full: Obj = {
      age: p.age,
      sex: p.sex,
      height_cm: p.height_cm,
      weight_kg: p.weight_kg,
      activity_level: p.activity_level,
      job: p.profession_type,
      goal: p.goal,
      days_per_week: p.days_per_week,
      session_duration_minutes: p.session_duration,
      available_days: Array.isArray(p.available_days)
        ? (p.available_days as string[]).map((d) => SHORT_TO_DAY[d.toLowerCase()] ?? d.toLowerCase())
        : null,
    };
    profile = Object.fromEntries(Object.entries(full).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0)));
    if (Object.keys(profile).length === 0) profile = null;
  }

  let notes: string | null = null;
  if (includeNotes) {
    // Missing table (migration not applied) or no note: just go without.
    const { data: n } = await db.from('client_notes').select('body').eq('client_id', clientId).maybeSingle();
    const body = typeof n?.body === 'string' ? n.body.trim() : '';
    notes = body ? body.slice(0, MAX_NOTES_CHARS) : null;
  }
  return { profile, notes };
}

/* ---------------- result ---------------- */

/** Just enough structure to be worth sending back; the panel clamps and
 *  validates every field before it reaches the builder. */
function asProgram(raw: unknown): Obj | null {
  if (!isObj(raw) || !Array.isArray(raw.days)) return null;
  const days = raw.days.filter((d) => isObj(d) && Array.isArray(d.exercises) && d.exercises.length > 0);
  if (days.length === 0) return null;
  return { ...raw, days, weeks: Array.isArray(raw.weeks) ? raw.weeks : [] };
}

function exercisesOf(program: Obj): Obj[] {
  return (program.days as Obj[]).flatMap((d) => (d.exercises as unknown[]).filter(isObj));
}

/**
 * Puts every exercise name onto the catalog, in place:
 *   1. exact catalog name, or a custom name the coach already had in
 *      `current` → kept;
 *   2. same name up to case/accents/punctuation → the catalog spelling;
 *   3. anything else → one small follow-up call asking for the closest
 *      catalog exercise (when there's time left in the request).
 * Returns the names that still don't resolve; the panel drops those rows.
 */
async function resolveNames(
  program: Obj,
  catalog: CatalogRow[],
  current: Obj | null,
  canRepair: boolean,
): Promise<string[]> {
  const known = new Map<string, string>(); // normalized → spelling to use
  for (const r of catalog) known.set(normalize(r.name), r.name);
  const catalogNames = new Set(catalog.map((r) => r.name));
  const exact = new Set(catalogNames);

  // The coach's own custom movements in the program being edited are allowed.
  if (current && Array.isArray(current.days)) {
    for (const d of current.days) {
      if (!isObj(d) || !Array.isArray(d.exercises)) continue;
      for (const x of d.exercises) {
        if (isObj(x) && typeof x.name === 'string' && x.name.trim()) {
          exact.add(x.name.trim());
          if (!known.has(normalize(x.name))) known.set(normalize(x.name), x.name.trim());
        }
      }
    }
  }

  const unknown = new Set<string>();
  for (const x of exercisesOf(program)) {
    const name = typeof x.name === 'string' ? x.name.trim() : '';
    x.name = name;
    if (!name || exact.has(name)) continue;
    const match = known.get(normalize(name));
    if (match) x.name = match;
    else unknown.add(name);
  }
  if (unknown.size === 0 || !canRepair) return [...unknown];

  try {
    const { json: raw } = await completeJSON(
      {
        system: REPAIR_PROMPT,
        user: JSON.stringify({ unknown: [...unknown], exercise_catalog: groupCatalog(catalog) }),
        schema: REPAIR_SCHEMA,
        timeoutMs: 15_000,
        maxOutputTokens: 4096,
        thinking: 'low',
      },
      10_000,
    );
    const pairs = isObj(raw) && Array.isArray(raw.map) ? raw.map.filter(isObj) : [];
    const swap = new Map<string, string>();
    for (const p of pairs) {
      if (typeof p.from !== 'string' || typeof p.to !== 'string') continue;
      const wanted = p.to.trim();
      const to = catalog.find((r) => r.name === wanted)?.name ?? known.get(normalize(wanted));
      if (to && catalogNames.has(to)) swap.set(p.from.trim(), to);
    }
    for (const x of exercisesOf(program)) {
      const to = swap.get(x.name as string);
      if (to) x.name = to;
    }
    for (const from of swap.keys()) unknown.delete(from);
  } catch (e) {
    console.warn('exercise name repair failed:', e);
  }
  return [...unknown];
}
