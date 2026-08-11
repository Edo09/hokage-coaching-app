import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FadeInDown, FadeOutUp } from "react-native-reanimated";

import { formatClock, useRestTimer } from "@/src/providers/rest-timer-provider";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import { AnimatedView } from "@/src/tw/animated";

/**
 * The "+30" control is hidden for now. Flip to true to bring it back — the
 * button, its green confirmation flash, and the double-tap cooldown are all
 * still here and wired up, so this is the only line that needs changing.
 */
const SHOW_ADD_TIME = false;

/** Seconds the "+30" control adds. */
const ADD_SECONDS = 30;
/** How long the confirmation stays up before it floats away. */
const FLASH_MS = 900;
/**
 * Ignore repeat presses for this long. Tuned to sit above an accidental
 * double-tap (~250ms) but below a deliberate second press, so someone who
 * genuinely wants +60 just taps again and it lands.
 */
const COOLDOWN_MS = 600;

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

  // Adding time moves the clock by a number that's easy to miss mid-set, so the
  // press gets its own confirmation. Keyed by a counter rather than a boolean:
  // remounting is what replays the entering animation, so tapping twice quickly
  // reads as two distinct bumps instead of one stuck label.
  const [flashId, setFlashId] = useState(0);
  const nextId = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cooldown is held in a ref AND mirrored to state: the ref is the actual
  // guard (it's current the instant the handler runs, so a double-tap inside
  // one render tick can't slip through), while the state exists only to dim
  // the button so the ignored press doesn't read as a broken tap.
  const coolingRef = useRef(false);
  const [cooling, setCooling] = useState(false);
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current != null) clearTimeout(timeoutRef.current);
      if (cooldownRef.current != null) clearTimeout(cooldownRef.current);
    };
  }, []);

  const bumpTime = () => {
    if (coolingRef.current) return;
    coolingRef.current = true;
    setCooling(true);
    if (cooldownRef.current != null) clearTimeout(cooldownRef.current);
    cooldownRef.current = setTimeout(() => {
      coolingRef.current = false;
      setCooling(false);
    }, COOLDOWN_MS);

    addTime(ADD_SECONDS);
    nextId.current += 1;
    const id = nextId.current;
    setFlashId(id);
    if (timeoutRef.current != null) clearTimeout(timeoutRef.current);
    // Guarded by id so a stale timer can't clear a newer flash.
    timeoutRef.current = setTimeout(
      () => setFlashId((cur) => (cur === id ? 0 : cur)),
      FLASH_MS,
    );
  };

  if (!running) return null;

  const pct = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const done = remaining === 0;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, right: 0, bottom, zIndex: 50 }}
    >
      {/* Floats above the clock it just changed, so the eye connects "+30s"
          with the number that jumped. Outside the bar's overflow-hidden, or it
          would be clipped. */}
      {flashId !== 0 && (
        <AnimatedView
          key={flashId}
          entering={FadeInDown.duration(140)}
          exiting={FadeOutUp.duration(280)}
          pointerEvents="none"
          // left aligns with the clock digits (mx-3 + px-3). bottom = card
          // height (~73) + mb-2 (8) + a 5px gap, measured rather than guessed:
          // at 76 the label clipped the card's top edge.
          style={{ position: "absolute", left: 26, bottom: 86, zIndex: 60 }}
        >
          <Text
            className="text-[17px] font-bold"
            style={{ color: colors.success, fontVariant: ["tabular-nums"] }}
          >
            +{ADD_SECONDS}s
          </Text>
        </AnimatedView>
      )}

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
              {SHOW_ADD_TIME && (
                <CircleBtn
                  label={t("program.restAdd30")}
                  onPress={bumpTime}
                  disabled={cooling}
                  tint={colors.contentSecondary}
                >
                  <Text
                    className="text-[11px] font-bold text-content-secondary"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    +{ADD_SECONDS}
                  </Text>
                </CircleBtn>
              )}

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
  disabled = false,
}: {
  children: React.ReactNode;
  label: string;
  onPress: () => void;
  tint: string;
  solid?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={6}
      className="h-9 w-9 flex-none items-center justify-center rounded-full border"
      style={{
        borderColor: tint,
        backgroundColor: solid ? `${tint}22` : "transparent",
        // Dimmed rather than hidden: the control must stay where the thumb
        // expects it, and the fade explains why the next tap did nothing.
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </Pressable>
  );
}
