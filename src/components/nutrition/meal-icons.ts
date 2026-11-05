import type { Ionicons } from "@expo/vector-icons";
import type React from "react";

import type { PlanMealType } from "@/src/types/database";

export type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

/** Each plan meal type's icon: the meal cards, the sheet and Inicio. */
export const MEAL_ICON: Record<PlanMealType, IoniconName> = {
  breakfast: "sunny-outline",
  lunch: "restaurant-outline",
  dinner: "moon-outline",
  snack: "cafe-outline",
  pre_workout: "flash-outline",
  post_workout: "barbell-outline",
};
