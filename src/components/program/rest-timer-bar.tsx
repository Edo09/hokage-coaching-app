import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";

import { formatClock, useRestTimer } from "@/src/providers/rest-timer-provider";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";

/**
 * The floating rest countdown. Rendered once, above the tab bar, so it survives
 * scrolling the day, opening an exercise sheet, or switching tabs mid-rest.
 *
 * Renders nothing when idle — it must never occupy space it isn't using.
 */
export function RestTimerBar({ bottom = 0 }: { bottom?: number }) {
  const { t } = useTranslation();
  const colors = useColors();
  const { remaining, total, label, running, paused, stop, togglePause, addTime } =
    useRestTimer();

  if (!running) return null;

  const pct = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const done = remaining === 0;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, right: 0, bottom, zIndex: 50 }}
    >
      <View className="mx-3 mb-2 overflow-hidden rounded-2xl border border-border bg-surface">
        {/* Progress drains left-to-right as the rest burns down. */}
        <View className="h-1 w-full bg-surface-elevated">
          <View
            style={{
              height: "100%",
              width: `${pct * 100}%`,
              backgroundColor: done ? colors.success : colors.brandPrimary,
            }}
          />
        </View>

        <View className="flex-row items-center gap-3 px-3 py-2.5">
          <View className="min-w-0 flex-1">
            <Text
              className={
                done
                  ? "text-2xl font-bold text-success"
                  : "text-2xl font-bold text-content-primary"
              }
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {formatClock(remaining)}
            </Text>
            <Text className="text-[11px] text-content-tertiary" numberOfLines={1}>
              {done
                ? t("program.restDone")
                : (label ?? t("program.restEyebrow"))}
            </Text>
          </View>

          {!done && (
            <>
              <CircleBtn
                label={t("program.restAdd30")}
                onPress={() => addTime(30)}
                tint={colors.contentSecondary}
              >
                <Text
                  className="text-[11px] font-bold text-content-secondary"
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  +30
                </Text>
              </CircleBtn>

              <CircleBtn
                label={t(paused ? "program.restResume" : "program.restPause")}
                onPress={togglePause}
                tint={colors.contentSecondary}
              >
                <Ionicons
                  name={paused ? "play" : "pause"}
                  size={16}
                  color={colors.contentSecondary}
                />
              </CircleBtn>
            </>
          )}

          <CircleBtn label={t("program.restSkip")} onPress={stop} tint={colors.brandPrimary} solid>
            <Ionicons name="close" size={17} color={colors.brandPrimary} />
          </CircleBtn>
        </View>
      </View>
    </View>
  );
}

function CircleBtn({
  children,
  label,
  onPress,
  tint,
  solid = false,
}: {
  children: React.ReactNode;
  label: string;
  onPress: () => void;
  tint: string;
  solid?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      className="h-9 w-9 flex-none items-center justify-center rounded-full border"
      style={{
        borderColor: tint,
        backgroundColor: solid ? `${tint}22` : "transparent",
      }}
    >
      {children}
    </Pressable>
  );
}
