import { AiError, completeJSON, completeJSONWithImage, type ImageInput } from "@/src/services/llm";
import type { MealType } from "@/src/types/database";

export type NutritionEstimate = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  portion: string;
};

export type PhotoNutritionEstimate = NutritionEstimate & {
  /** Dish name detected from the photo, in the requested language. */
  name: string;
};

function clampNum(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (isNaN(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
}

export async function estimateMealNutrition(
  mealName: string,
  mealType: MealType,
  language: string
): Promise<NutritionEstimate & { name: string }> {
  const languageName = language === "es" ? "Spanish" : "English";

  const system = [
    "You are a nutritionist. Estimate the nutrition facts for one typical serving of the given meal.",
    "Respond ONLY with strict JSON matching this schema:",
    '{"name":string,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number,"portion":string}',
    "Rules:",
    `- name: the user's meal name, cleaned up in ${languageName}: fix typos and`,
    "  capitalization, expand lazy shorthand into a clear dish name — but keep",
    "  the user's intent; never invent a different dish.",
    "- Values are for ONE typical serving of the dish as commonly prepared.",
    "- calories in kcal; protein_g/carbs_g/fat_g in grams.",
    `- portion is a short human description of the serving (e.g. "1 bowl (400g)") in ${languageName}.`,
  ].join("\n");

  const user = JSON.stringify({ meal_name: mealName, meal_type: mealType });

  const raw = (await completeJSON(system, user)) as Record<string, unknown>;

  const calories = clampNum(raw?.calories, 0, 5000);
  const protein = clampNum(raw?.protein_g, 0, 500);
  const carbs = clampNum(raw?.carbs_g, 0, 1000);
  const fat = clampNum(raw?.fat_g, 0, 500);
  if (calories == null) throw new Error("AI returned no calories");

  const name =
    typeof raw?.name === "string" && raw.name.trim().length > 0
      ? raw.name.trim().slice(0, 80)
      : mealName;

  return {
    name,
    calories: Math.round(calories),
    protein_g: protein ?? 0,
    carbs_g: carbs ?? 0,
    fat_g: fat ?? 0,
    portion:
      typeof raw?.portion === "string" && raw.portion.trim().length > 0
        ? raw.portion.trim().slice(0, 60)
        : "1 serving",
  };
}

export async function estimateMealNutritionFromPhoto(
  image: ImageInput,
  language: string,
  userMealName?: string
): Promise<PhotoNutritionEstimate> {
  const languageName = language === "es" ? "Spanish" : "English";

  const system = [
    "You are a nutritionist. Identify the food in the photo and estimate its nutrition facts for the visible portion.",
    "Respond ONLY with strict JSON matching this schema:",
    '{"name":string,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number,"portion":string}',
    "Rules:",
    `- name: a short dish name in ${languageName} (e.g. "Chicken & rice bowl").`,
    "- Estimate for the portion VISIBLE in the photo.",
    "- calories in kcal; protein_g/carbs_g/fat_g in grams.",
    `- portion: short description of the visible serving (e.g. "1 plate (~350g)") in ${languageName}.`,
    "- If the user provides a name for the meal, treat it as a strong hint:",
    "  use it to disambiguate visually similar dishes and to account for",
    "  ingredients it implies that are not visible (fillings, sauces, cooking",
    "  oil, preparation style). The photo still decides the portion size.",
    "- If the photo and the user's name clearly conflict, trust the photo for",
    "  what is visible but keep the user's naming intent.",
    "- If the image is not food, return {\"name\":\"\"} only.",
  ].join("\n");

  const trimmedName = userMealName?.trim();
  const user =
    trimmedName != null && trimmedName.length > 0
      ? `The user says this meal is: "${trimmedName}". Identify it in the photo using that as a strong hint and estimate its nutrition.`
      : "Identify this meal.";

  const raw = (await completeJSONWithImage(system, user, image)) as Record<string, unknown>;

  const name = typeof raw?.name === "string" ? raw.name.trim().slice(0, 80) : "";
  if (name.length === 0) throw new AiError("no_food", "No food detected in photo");

  const calories = clampNum(raw?.calories, 0, 5000);
  if (calories == null) throw new Error("AI returned no calories");

  return {
    name,
    calories: Math.round(calories),
    protein_g: clampNum(raw?.protein_g, 0, 500) ?? 0,
    carbs_g: clampNum(raw?.carbs_g, 0, 1000) ?? 0,
    fat_g: clampNum(raw?.fat_g, 0, 500) ?? 0,
    portion:
      typeof raw?.portion === "string" && raw.portion.trim().length > 0
        ? raw.portion.trim().slice(0, 60)
        : "1 serving",
  };
}
