import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useWindowDimensions } from "react-native";

import { Burst } from "@/src/components/ui";
import { usePop } from "@/src/lib/motion";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import { AnimatedView } from "@/src/tw/animated";
import type { ProgramExercise, ProgramWeek } from "@/src/types/database";
import { cn } from "@/src/utils/cn";
import {
  effectivePrescription,
  formatLoadPct,
  formatReps,
  formatRir,
  parseTempo,
} from "@/src/utils/program";

type Props = {
  exercise: ProgramExercise;
  week: ProgramWeek | null;
  /** The week being viewed (week_overrides apply even with no week row). */
  weekNumber?: number;
  /** The program's tempo, for an exercise that sets none. */
  tempoDefault?: string | null;
  /** Opens the demo video for a catalog exercise that has a video_url. */
  onPlay?: (uri: string) => void;
  /** Phase 3 completion checkbox. */
  done?: boolean;
  onToggleDone?: () => void;
  /** "Solo semana actual": the viewed week isn't open yet, so the checkbox
      shows a lock and can't be pressed. Never set for free programs. */
  locked?: boolean;
  /** Tap the row body to open the detail + set-logging sheet. */
  onOpen?: () => void;
  /** Count of logged sets for the viewed week (shown as a subtle hint). */
  loggedCount?: number;
};

// The demo GIF's thumbnail: a third of the screen's width, so the movement
// reads at a glance, within bounds. Past 120 the catalog's 180×180 GIFs go
// soft, and below 88 they're too small to follow; the name and prescription
// beside it wrap in what's left.
const THUMB_RATIO = 0.3;
const THUMB_MIN = 88;
const THUMB_MAX = 120;

// One prescription line, resolved for the selected week. Load shows %1RM when
// present, else the qualitative tag (ligero/moderado/pesado) — the decided
// display precedence — then the RIR and the tempo («Tempo 3-1-2-0») the
// client follows. The checkbox marks the exercise done; tapping anywhere else
// opens the detail + set-logging sheet (Phase 3). No rest timer here: a rest
// comes after training, inside the sheet.
export function ProgramExerciseRow({
  exercise,
  week,
  weekNumber,
  tempoDefault = null,
  onPlay,
  done = false,
  onToggleDone,
  locked = false,
  onOpen,
  loggedCount = 0,
}: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const { width: screenWidth } = useWindowDimensions();
  const thumb = Math.round(Math.min(THUMB_MAX, Math.max(THUMB_MIN, screenWidth * THUMB_RATIO)));
  const p = effectivePrescription(exercise, week, weekNumber ?? week?.week_number ?? null, tempoDefault);
  const videoUrl = exercise.exercise?.video_url ?? null;
  // A tempo written as 3-1-2-0 is a chip; older free text stays a note line.
  const tempo = parseTempo(p.tempo);
  const tempoText = tempo == null ? p.tempo : null;

  const setsReps = p.isUnilateral
    ? t("program.setsRepsPerSide", {
        sets: p.sets,
        reps: formatReps(p.repMin, p.repMax),
      })
    : t("program.setsReps", {
        sets: p.sets,
        reps: formatReps(p.repMin, p.repMax),
      });

  const loadPct = formatLoadPct(p);
  const rir = formatRir(p);
  const qual =
    p.loadPct == null && p.loadQualitative != null
      ? t(`program.load_${p.loadQualitative}`)
      : null;

  const hasVideo = videoUrl != null && videoUrl !== "";
  // GIF/WebP demos auto-loop inline as the row thumbnail (expo-image animates
  // them). Real videos (later) don't autoplay in a list — keep the play button.
  const isInlineGif = hasVideo && /\.(gif|apng|webp|png|jpe?g)$/i.test(videoUrl.split("?")[0]);
  const showPlay = onPlay != null && hasVideo && !isInlineGif;
  // Tapping the thumbnail opens the fullscreen player if available, else the
  // detail sheet — never a dead tap.
  const onThumbPress = () => {
    if (onPlay != null && videoUrl != null) onPlay(videoUrl);
    else onOpen?.();
  };

  const icon = (
    <>
      <Ionicons
        name={p.hasCatalog ? "barbell-outline" : "ellipse-outline"}
        size={14}
        color={colors.contentTertiary}
      />
      {showPlay && (
        // Inline rgba: bg-black/30 opacity modifier doesn't compile under
        // react-native-css.
        <View
          className="absolute inset-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
        >
          <Ionicons name="play" size={13} color="#fff" />
        </View>
      )}
    </>
  );

  return (
    <View className="flex-row items-start gap-3 py-2.5">
      {/* Backdrop so the row's empty space (beside the notes, under the
          checkbox) opens the sheet too. It sits BEHIND the controls as a
          sibling rather than wrapping them — wrapping would nest buttons on
          RN Web. Non-interactive content above it uses pointerEvents so taps
          fall through; screen readers already have the body button. */}
      {onOpen != null && (
        <Pressable
          onPress={onOpen}
          accessible={false}
          tabIndex={-1}
          aria-hidden
          className="absolute inset-0"
        />
      )}

      {isInlineGif ? (
        <Pressable
          onPress={onThumbPress}
          accessibilityRole="button"
          accessibilityLabel={t("program.watchDemo", { name: p.name })}
          className="overflow-hidden rounded-xl bg-brand-dark"
          style={{ width: thumb, height: thumb }}
        >
          <Image
            source={{ uri: videoUrl! }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
          />
        </Pressable>
      ) : showPlay ? (
        <Pressable
          onPress={() => {
            if (videoUrl != null) onPlay?.(videoUrl);
          }}
          accessibilityRole="button"
          accessibilityLabel={t("program.watchDemo", { name: p.name })}
          className="mt-0.5 h-7 w-7 items-center justify-center rounded-lg bg-brand-dark"
        >
          {icon}
        </Pressable>
      ) : (
        <View
          pointerEvents="none"
          className="mt-0.5 h-7 w-7 items-center justify-center rounded-lg bg-brand-dark"
        >
          {icon}
        </View>
      )}

      {/* Row body. The tappable area stops above the meta line, which is
          display-only: its taps fall through to the backdrop. */}
      <View pointerEvents="box-none" className="flex-1 gap-1">
      <Pressable
        onPress={onOpen}
        disabled={onOpen == null}
        accessibilityRole="button"
        accessibilityLabel={t("program.openExercise", { name: p.name })}
        className="gap-1"
      >
        <View className="flex-row items-center gap-1.5">
          <Text
            className={
              done
                ? "flex-1 text-[14px] font-semibold text-content-muted line-through"
                : "flex-1 text-[14px] font-semibold text-content-primary"
            }
          >
            {p.name}
          </Text>
          {loggedCount > 0 && (
            <View className="flex-row items-center gap-1 rounded-md bg-info-soft px-1.5 py-0.5">
              <Ionicons name="create-outline" size={11} color={colors.brandSecondary} />
              <Text className="text-[10px] font-semibold text-brand-secondary" style={TABULAR}>
                {t("program.setsLogged", { count: loggedCount, total: p.sets })}
              </Text>
            </View>
          )}
          {onOpen != null && (
            <Ionicons name="chevron-forward" size={15} color={colors.contentMuted} />
          )}
        </View>

        <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
          <Text className="text-[13px] font-medium text-content-secondary" style={TABULAR}>
            {setsReps}
          </Text>
          {p.weekAdjusted && (
            <Text className="rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning">
              {t("program.weekAdjusted")}
            </Text>
          )}

          {loadPct != null && (
            <Chip tone="info" style={TABULAR}>
              {loadPct}
            </Chip>
          )}
          {qual != null && <Chip tone="muted">{qual}</Chip>}
          {rir != null && (
            <Chip tone="accent" style={TABULAR}>
              {rir}
            </Chip>
          )}
          {tempo != null && (
            <Chip tone="muted" style={TABULAR}>
              {t("program.tempoLabel", { tempo: tempo.join("-") })}
            </Chip>
          )}
        </View>

      </Pressable>

      {/* Meta line: display-only, a sibling of the body. */}
      {(tempoText != null || (p.notes != null && p.notes !== "")) && (
        <View
          pointerEvents="box-none"
          className="mt-0.5 flex-row flex-wrap items-center gap-x-3 gap-y-1.5"
        >
          {tempoText != null && (
            <Meta icon="time-outline">{t("program.tempoLabel", { tempo: tempoText })}</Meta>
          )}
          {p.notes != null && p.notes !== "" && (
            // Text has no pointerEvents prop; the wrapper lets taps reach the
            // backdrop.
            <View pointerEvents="none" className="min-w-0 shrink">
              <Text className="text-[11px] text-content-tertiary">{p.notes}</Text>
            </View>
          )}
        </View>
      )}
      </View>

      {onToggleDone != null && (
        <DoneCheckbox done={done} name={p.name} onToggle={onToggleDone} locked={locked} />
      )}
    </View>
  );
}

/**
 * The completion check. Checking it off is the moment the client finished an
 * exercise, so it answers with a pop, impact lines and a haptic; unchecking
 * stays quiet. Shared with the home card's rows. Locked (a week that isn't
 * open yet, "Solo semana actual"), it can't be pressed: an empty check shows
 * a lock, and one made before the lock came on stays, faded.
 */
export function DoneCheckbox({
  done,
  name,
  onToggle,
  locked = false,
  className = "mt-0.5",
  label,
}: {
  done: boolean;
  name: string;
  onToggle: () => void;
  /** The week isn't open yet: shown, not pressable. */
  locked?: boolean;
  /** Placement of the 24px check (margins). */
  className?: string;
  /** Screen-reader label, for a check that isn't an exercise (supplements). */
  label?: string;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const check = usePop();
  const [burst, setBurst] = useState(0);

  const onPress = () => {
    if (!done) {
      check.pop();
      setBurst((n) => n + 1);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    onToggle();
  };

  return (
    <View className={cn("h-6 w-6", className)}>
      <Burst play={burst} from={15} to={27} colors={[colors.success, colors.contentPrimary]} />
      <AnimatedView style={check.style}>
        <Pressable
          onPress={onPress}
          disabled={locked}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done, disabled: locked }}
          accessibilityLabel={
            label ??
            (locked
              ? t("program.lockedA11y", { name })
              : t(done ? "program.markUndone" : "program.markDone", { name }))
          }
          hitSlop={8}
          className={
            done
              ? "h-6 w-6 items-center justify-center rounded-full bg-success"
              : locked
                ? "h-6 w-6 items-center justify-center rounded-full bg-surface-elevated"
                : "h-6 w-6 items-center justify-center rounded-full border-2 border-border-strong"
          }
          style={locked && done ? { opacity: 0.5 } : undefined}
        >
          {done && <Ionicons name="checkmark" size={15} color={colors.white} />}
          {!done && locked && <Ionicons name="lock-closed" size={12} color={colors.contentMuted} />}
        </Pressable>
      </AnimatedView>
    </View>
  );
}

const TABULAR = { fontVariant: ["tabular-nums" as const] };

function Chip({
  children,
  tone,
  style,
}: {
  children: React.ReactNode;
  tone: "info" | "accent" | "muted";
  style?: object;
}) {
  const cls =
    tone === "info"
      ? "bg-info-soft"
      : tone === "accent"
        ? "bg-brand-accent-soft"
        : "bg-surface-elevated";
  const textCls =
    tone === "info"
      ? "text-brand-secondary"
      : tone === "accent"
        ? "text-brand-accent"
        : "text-content-tertiary";
  return (
    <View className={`rounded-md px-2 py-0.5 ${cls}`}>
      <Text className={`text-[11px] font-semibold ${textCls}`} style={style}>
        {children}
      </Text>
    </View>
  );
}

function Meta({
  icon,
  children,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  children: React.ReactNode;
}) {
  const colors = useColors();
  // Display-only: taps pass through to the row backdrop. It shrinks, so a
  // long line (a tempo written out) wraps inside the column instead of
  // running past the card; the icon stays with the first line.
  return (
    <View pointerEvents="none" className="min-w-0 shrink flex-row items-start gap-1">
      <Ionicons name={icon} size={11} color={colors.contentMuted} style={{ marginTop: 2 }} />
      <Text className="shrink text-[11px] text-content-tertiary">{children}</Text>
    </View>
  );
}
