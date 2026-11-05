import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";

import { Burst, Skewed } from "@/src/components/ui";
import { usePop } from "@/src/lib/motion";
import { useColors } from "@/src/theme/colors";
import { View } from "@/src/tw";
import { AnimatedView } from "@/src/tw/animated";
import { cn } from "@/src/utils/cn";

export type StatusBoxState = "pending" | "next" | "plan" | "other" | "skipped";

const LOOK: Record<StatusBoxState, string> = {
  pending: "border-[1.5px] border-dashed border-content-muted",
  next: "border-2 border-brand-primary",
  plan: "bg-brand-primary",
  other: "bg-surface-elevated",
  skipped: "border-[1.5px] border-border-strong bg-brand-dark",
};

/**
 * The slanted box on the right of each meal card: dashed while pending, red
 * outline for «Siguiente», red ✓ from the plan, grey ⇄ for «otra comida», grey
 * – for «No la comí». When `popKey` grows (the client just saved this meal)
 * it pops like Programa's check, with its burst and haptic; «No la comí»
 * never pops. The pop scale, the burst and the skew sit on separate views:
 * the last `transform` would win otherwise.
 */
export function StatusBox({ state, popKey }: { state: StatusBoxState; popKey: number }) {
  const colors = useColors();
  const check = usePop();
  const played = useRef(0);
  const pops = state === "plan" || state === "other";

  useEffect(() => {
    if (!pops || popKey === 0 || popKey === played.current) return;
    played.current = popKey;
    check.pop();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, [pops, popKey, check]);

  return (
    <View className="h-[26px] w-[26px] justify-center">
      <Burst play={pops ? popKey : 0} from={15} to={27} colors={[colors.brandPrimary, colors.contentPrimary]} />
      <AnimatedView style={check.style}>
        <Skewed deg={-8} className={cn("h-[26px] w-[26px] justify-center", LOOK[state])}>
          {state === "plan" && <Ionicons name="checkmark" size={14} color={colors.white} />}
          {state === "other" && <Ionicons name="swap-horizontal" size={13} color={colors.contentSecondary} />}
          {state === "skipped" && <Ionicons name="remove" size={14} color={colors.contentMuted} />}
        </Skewed>
      </AnimatedView>
    </View>
  );
}
