// Pure logic for the estimate-meal Edge Function: the prompt, reading the
// model's answer, the guard that keeps a spelling "correction" from changing
// what the client wrote, and a failure's text for meal_estimate_errors. It has
// no imports, so both Deno and the app's `npm test`
// (src/utils/meal-estimate.test.ts) can load it.

export type EstimateKind = 'plan' | 'other';
export type EstimateResult = { calories: number; protein_g: number; carbs_g: number; fat_g: number; corrected: string | null };

/** The most of the client's text the model ever sees. */
export const MAX_TEXT_CHARS = 600;

const LIMITS = { calories: 5000, protein_g: 500, carbs_g: 1000, fat_g: 500 } as const;

/** The system and user messages for one estimate. With a photo, the function
 *  attaches the image to the same request. */
export function buildEstimatePrompt(input: { kind: EstimateKind; text: string; hasPhoto: boolean }): {
  system: string;
  user: string;
} {
  const shape =
    input.kind === 'other'
      ? '{"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number,"corrected_text":string}'
      : '{"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number}';
  const lines = [
    'You are a nutritionist. Estimate the calories and macros of what a client ate.',
    `Respond ONLY with strict JSON: ${shape}`,
    'Rules:',
    '- "text" is exactly what the client ate. Estimate that; never rename it or turn it into a different dish.',
    '- Quantities written in the text (for example "80 g avena", "2 huevos enteros") set the portion.',
    '- When a photo is attached, it changes those quantities only if the plate clearly shows a different amount (a double portion, a missing food). With no written quantities the photo sets the portion; with neither, estimate one typical serving.',
    '- The photo never names the meal. If the photo is not food, ignore it and estimate from the text.',
    '- calories in kcal; protein_g, carbs_g and fat_g in grams.',
  ];
  if (input.kind === 'other') {
    lines.push(
      '- corrected_text: the same text with ONLY spelling, accents and capital letters fixed, in the same language.',
      '  Same words, same order, same quantities; add, remove or reword nothing. When unsure, return the text unchanged.',
    );
  }
  return {
    system: lines.join('\n'),
    user: JSON.stringify({ text: input.text.slice(0, MAX_TEXT_CHARS), photo: input.hasPhoto }),
  };
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** The model's JSON as an estimate, or null when it can't be trusted (which
 *  the function treats as a provider failure). */
export function parseEstimate(raw: unknown, kind: EstimateKind): EstimateResult | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const calories = toNumber(o.calories);
  if (calories == null || calories < 0 || calories > LIMITS.calories) return null;

  const macro = (key: 'protein_g' | 'carbs_g' | 'fat_g'): number | null => {
    if (o[key] == null) return 0;
    const n = toNumber(o[key]);
    return n == null || n < 0 || n > LIMITS[key] ? null : Math.round(n * 10) / 10;
  };
  const protein_g = macro('protein_g');
  const carbs_g = macro('carbs_g');
  const fat_g = macro('fat_g');
  if (protein_g == null || carbs_g == null || fat_g == null) return null;

  const corrected = kind === 'other' && typeof o.corrected_text === 'string' ? o.corrected_text.trim() : '';
  return { calories: Math.round(calories), protein_g, carbs_g, fat_g, corrected: corrected === '' ? null : corrected };
}

function tokens(s: string): string[] {
  const flat = s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat === '' ? [] : flat.split(' ');
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** Edits a word may take and still count as a misspelling of itself. Tight on
 *  purpose: it stops a rewrite into another food («ensalada» → «empanada»).
 *  A one-letter swap can still change the food («batata» → «patata»); no
 *  distance rule can tell that from a typo, so the prompt's spelling-only
 *  instruction carries that case. */
function allowedDistance(n: number): number {
  if (n <= 3) return 1;
  if (n <= 8) return 2;
  return 3;
}

/** Whether a spelling correction may replace the client's text: same words in
 *  the same order, numbers untouched, each word only a typo away. Ignores
 *  case, accents and punctuation. */
export function acceptCorrection(original: string, corrected: string): boolean {
  const a = tokens(original);
  const b = tokens(corrected);
  if (b.length === 0 || a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    if (/\p{N}/u.test(x) || /\p{N}/u.test(y)) return x === y;
    return levenshtein(x, y) <= allowedDistance(Math.max(x.length, y.length));
  });
}

/** The most of a failure's text kept in meal_estimate_errors. */
export const MAX_FAILURE_CHARS = 1000;

/** A failure as one line for meal_estimate_errors: the message (or the name,
 *  when there is none), with a database error's code before it and its
 *  details after; anything else as text. */
export function failureText(e: unknown): string {
  let text = String(e);
  if (typeof e === 'object' && e !== null) {
    const o = e as { name?: unknown; message?: unknown; code?: unknown; details?: unknown };
    const message = typeof o.message === 'string' && o.message !== '' ? o.message : typeof o.name === 'string' ? o.name : text;
    const code = typeof o.code === 'string' && o.code !== '' ? `${o.code}: ` : '';
    const details = typeof o.details === 'string' && o.details !== '' ? ` (${o.details})` : '';
    text = code + message + details;
  }
  return text.slice(0, MAX_FAILURE_CHARS);
}

/** Photos live under "<user_id>/…" in the meal-photos bucket; the function
 *  reads one with the service role, so this is the only scope check. */
export function photoPathAllowed(userId: string, path: string): boolean {
  return userId !== '' && path.startsWith(`${userId}/`) && !path.includes('..');
}
