// Coach Admin Panel — drafts a nutrition plan from the coach's prompt with
// an LLM. Two modes, one call:
//   - new:  { prompt }                   → a whole plan from scratch
//   - edit: { prompt, current }          → `current` (the builder's draft, in
//                                          the shape described in prompt.ts)
//                                          with the requested changes applied
// Either can carry { client_id, include_notes } to fit the plan to a client
// (profile fields; the coach's private note only when include_notes is true).
//
// This function only DRAFTS. It writes nothing: the panel loads the result
// into its builder, the coach reviews it, and saving goes through the normal
// save_nutrition_plan RPC and its checks. Foods are free text (there is no
// food catalog), so nothing is resolved or dropped here.
//
// Deploy, and give it the provider keys (see ../_shared/complete-json.ts) and
// ALLOWED_ORIGINS (see ../_shared/cors.ts):
//   supabase functions deploy generate-nutrition-plan --project-ref rzgwkwxskrovxnnymxqo

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { callerClient, verifyCoach } from '../_shared/coach.ts';
import { completeJSON } from '../_shared/complete-json.ts';
import { json, withCors } from '../_shared/cors.ts';
import { PLAN_SCHEMA, SYSTEM_PROMPT } from './prompt.ts';

const MAX_PROMPT_CHARS = 2000;
const MAX_CURRENT_CHARS = 200_000;
const MAX_NOTES_CHARS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

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
    if (!prompt) return json({ error: 'Escribe cómo quieres el plan.' }, 400);
    if (prompt.length > MAX_PROMPT_CHARS) {
      return json({ error: `La instrucción es muy larga (máximo ${MAX_PROMPT_CHARS} caracteres).` }, 400);
    }
    const current = isObj(body.current) ? body.current : null;
    if (current && JSON.stringify(current).length > MAX_CURRENT_CHARS) {
      return json({ error: 'El plan es demasiado grande para editarlo con IA.' }, 400);
    }
    const clientId = typeof body.client_id === 'string' && UUID.test(body.client_id) ? body.client_id : null;
    const includeNotes = body.include_notes === true;

    const db = callerClient(req);
    const client = clientId ? await loadClient(db, clientId, includeNotes) : null;

    // No food catalog: foods are free text, so the model gets only the
    // request, the client (when asked) and the draft being edited.
    const user = JSON.stringify({
      coach_request: prompt,
      ...(client?.profile ? { client: client.profile } : {}),
      ...(client?.notes ? { coach_notes: client.notes } : {}),
      ...(current ? { current_plan: current } : {}),
    });

    // Gemini 85 s + Groq 40 s stays under the 150 s wall-clock limit of the
    // smallest Supabase plan.
    const { json: raw, provider } = await completeJSON(
      { system: SYSTEM_PROMPT, user, schema: PLAN_SCHEMA, timeoutMs: 85_000, maxOutputTokens: 32_768 },
      40_000,
    );
    const plan = asPlan(raw);
    if (!plan) {
      const detail = `${provider} answered without usable meals (keys: ${isObj(raw) ? Object.keys(raw).join(', ') : typeof raw})`;
      console.error('generate-nutrition-plan failed:', detail);
      return json({ error: 'La IA no devolvió un plan válido. Intenta de nuevo.', detail }, 502);
    }

    return json({ plan, provider }, 200);
  } catch (e) {
    console.error('generate-nutrition-plan failed:', e);
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
  if (/\b503\b|UNAVAILABLE|high demand|overloaded/i.test(detail)) {
    return 'La IA está saturada en este momento. Intenta de nuevo en unos minutos.';
  }
  if (/timeout/i.test(detail)) {
    return 'La IA tardó demasiado en responder. Intenta de nuevo o pide un plan más corto.';
  }
  return 'No se pudo generar el plan. Intenta de nuevo en un momento.';
}

/* ---------------- context ---------------- */

/** Only what shapes a nutrition plan. No name, email or contact details go
 *  to the model; the private note only when the coach opted in. */
async function loadClient(
  db: SupabaseClient,
  clientId: string,
  includeNotes: boolean,
): Promise<{ profile: Obj | null; notes: string | null }> {
  const { data: p } = await db
    .from('profiles')
    .select('age, sex, height_cm, weight_kg, activity_level, profession_type, goal, calorie_goal, days_per_week')
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
      calorie_goal: p.calorie_goal,
      // Training days per week: tells the model the training/rest split.
      days_per_week: p.days_per_week,
    };
    profile = Object.fromEntries(Object.entries(full).filter(([, v]) => v != null));
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

/** Just enough structure to be worth sending back: a slot with an option that
 *  has a food. The panel clamps and validates every field before it reaches
 *  the builder. */
function asPlan(raw: unknown): Obj | null {
  if (!isObj(raw) || !Array.isArray(raw.meals)) return null;
  const meals = raw.meals.filter(
    (m) =>
      isObj(m) &&
      Array.isArray(m.options) &&
      m.options.some((o) => isObj(o) && Array.isArray(o.foods) && o.foods.length > 0),
  );
  if (meals.length === 0) return null;
  return { ...raw, meals, targets: Array.isArray(raw.targets) ? raw.targets : [] };
}
