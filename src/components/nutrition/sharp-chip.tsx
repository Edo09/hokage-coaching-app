import { Ionicons } from "@expo/vector-icons";

import type { IoniconName } from "@/src/components/nutrition/meal-icons";
import { CapsLabel, Skewed } from "@/src/components/ui";
import { useColors } from "@/src/theme/colors";
import { View } from "@/src/tw";
import { cn } from "@/src/utils/cn";

export type SharpChipTone = "red" | "neutral" | "solid" | "ai";

/**
 * The tab's square-cornered chips: «Opción N» (red), «Otra comida» / «No la
 * comí» / «Opcional» (neutral), «Siguiente» (solid red, slanted) and AI
 * (gold). Badge has no neutral tone and Chip is round, hence this one.
 */
export function SharpChip({ tone, icon, children }: { tone: SharpChipTone; icon?: IoniconName; children: string }) {
  const colors = useColors();

  if (tone === "solid") {
    return (
      <Skewed deg={-10} className="self-start bg-brand-primary px-2 py-[3px]" contentClassName="gap-1">
        {icon && <Ionicons name={icon} size={10} color={colors.white} />}
        <CapsLabel size={8.5} em={0.08} className="font-extrabold" style={{ color: colors.white }}>
          {children}
        </CapsLabel>
      </Skewed>
    );
  }

  const box =
    tone === "red" ? "bg-brand-primary-soft" : tone === "ai" ? "bg-brand-accent-soft" : "border border-border bg-brand-dark";
  const text =
    tone === "red" ? "text-brand-primary-light" : tone === "ai" ? "text-brand-accent" : "text-content-tertiary";
  const iconColor =
    tone === "red" ? colors.brandPrimary : tone === "ai" ? colors.brandAccent : colors.contentTertiary;

  return (
    <View className={cn("flex-row items-center gap-1 self-start px-1.5 py-[3px]", box)}>
      {icon && <Ionicons name={icon} size={10} color={iconColor} />}
      <CapsLabel size={8.5} em={0.08} numberOfLines={1} className={cn("font-extrabold", text)}>
        {children}
      </CapsLabel>
    </View>
  );
}
