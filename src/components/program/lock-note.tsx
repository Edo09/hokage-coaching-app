import { Ionicons } from "@expo/vector-icons";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";

import { useColors } from "@/src/theme/colors";
import { Text, View } from "@/src/tw";
import { cn } from "@/src/utils/cn";
import { formatShortDate } from "@/src/utils/dates";
import type { WeekLock } from "@/src/utils/program";

// "Solo semana actual": on a program with lock_future_weeks on, a week that
// hasn't opened yet (or every week, before the start) is view only. These
// say so, and when it opens, where a write control would otherwise be.

/** "Tu programa empieza el 1 oct" (before the start) / "Disponible desde el 6 oct". */
export function lockText(lock: WeekLock, t: TFunction, lang: string): string {
  const date = formatShortDate(lock.opensOn, lang);
  return lock.kind === "start"
    ? t("program.lockedStart", { date })
    : t("program.lockedWeek", { date });
}

/** A lock and one line of text on a quiet fill. Display only: taps pass through. */
export function LockLine({ text, className }: { text: string; className?: string }) {
  const colors = useColors();
  return (
    <View
      pointerEvents="none"
      className={cn("flex-row items-center gap-2 rounded-lg bg-surface-elevated px-3 py-2", className)}
    >
      <Ionicons name="lock-closed" size={13} color={colors.contentTertiary} />
      {/* shrink, so a long line wraps inside the row instead of running past it. */}
      <Text className="shrink text-[12px] font-semibold text-content-secondary">{text}</Text>
    </View>
  );
}

/** Why this week can't be checked yet: when it opens, or when the program starts. */
export function LockNote({ lock, className }: { lock: WeekLock; className?: string }) {
  const { t, i18n } = useTranslation();
  return <LockLine text={lockText(lock, t, i18n.language)} className={className} />;
}
