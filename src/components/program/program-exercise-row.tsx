import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React from "react";
import { useTranslation } from "react-i18next";

import { useRestTimer } from "@/src/providers/rest-timer-provider";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import type { ProgramExercise, ProgramWeek } from "@/src/types/database";
import {
  effectivePrescription,
  formatLoadPct,
  formatReps,
  formatRir,
} from "@/src/utils/program";

type Props = {
  exercise: ProgramExercise;
  week: ProgramWeek | null;
  /** Opens the demo video for a catalog exercise that has a video_url. */
  onPlay?: (uri: string) => void;
  /** Phase 3 completion checkbox. */
  done?: boolean;
  onToggleDone?: () => void;
  /** Tap the row body to open the detail + set-logging sheet. */
  onOpen?: () => void;
  /** Count of logged sets for the viewed week (shown as a subtle hint). */
  loggedCount?: number;
};

// One prescription line, resolved for the selected week. Load shows %1RM when
// present, else the qualitative tag (ligero/moderado/pesado) — the decided
// display precedence. The checkbox marks the exercise done; tapping the row
// body opens the detail + set-logging sheet (Phase 3).
export function ProgramExerciseRow({
  exercise,
  week,
  onPlay,
  done = false,
  onToggleDone,
  onOpen,
  loggedCount = 0,
}: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const p = effectivePrescription(exercise, week);
  const videoUrl = exercise.exercise?.video_url ?? null;

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
      {isInlineGif ? (
        <Pressable
          onPress={onThumbPress}
          accessibilityRole="button"
          accessibilityLabel={t("program.watchDemo", { name: p.name })}
          className="h-20 w-20 overflow-hidden rounded-xl bg-brand-dark"
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
        <View className="mt-0.5 h-7 w-7 items-center justify-center rounded-lg bg-brand-dark">
          {icon}
        </View>
      )}

      {/* Row body. The tappable area stops ABOVE the meta line so the rest
          timer can be its own button — nesting it inside this Pressable made
          RN Web emit a <button> inside a <button>, which is invalid HTML and
          fails hydration. */}
      <View className="flex-1 gap-1">
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
        </View>

      </Pressable>

      {/* Meta line — sibling of the body, never a child, so RestButton is a
          top-level button. */}
      {(p.tempo != null || p.restSeconds != null || p.notes != null) && (
        <View className="mt-0.5 flex-row flex-wrap items-center gap-x-3 gap-y-1.5">
          {p.tempo != null && (
            <Meta icon="time-outline">{t("program.tempoLabel", { tempo: p.tempo })}</Meta>
          )}
          {p.restSeconds != null && <RestButton seconds={p.restSeconds} name={p.name} />}
          {p.notes != null && p.notes !== "" && (
            <Text className="text-[11px] text-content-tertiary">{p.notes}</Text>
          )}
        </View>
      )}
      </View>

      {onToggleDone != null && (
        <Pressable
          onPress={onToggleDone}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={t(done ? "program.markUndone" : "program.markDone", { name: p.name })}
          hitSlop={8}
          className={
            done
              ? "mt-0.5 h-6 w-6 items-center justify-center rounded-full bg-success"
              : "mt-0.5 h-6 w-6 items-center justify-center rounded-full border-2 border-border-strong"
          }
        >
          {done && <Ionicons name="checkmark" size={15} color={colors.white} />}
        </Pressable>
      )}
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

/**
 * The coach's prescribed rest, made actionable. It reads as a normal meta line
 * until you notice the play affordance — same information, now one tap from
 * running.
 *
 * Lives OUTSIDE the row's Pressable. RN Web renders Pressable as <button>, and
 * a button inside a button is invalid HTML that breaks hydration — so the
 * tappable row body ends above this line rather than wrapping it.
 */
function RestButton({ seconds, name }: { seconds: number; name: string }) {
  const { t } = useTranslation();
  const colors = useColors();
  const { start, running, label } = useRestTimer();
  // Highlight only the row whose timer is actually counting.
  const isMine = running && label === name;

  return (
    <Pressable
      onPress={() => start(seconds, name)}
      accessibilityRole="button"
      accessibilityLabel={t("program.restStart", { seconds, name })}
      hitSlop={10}
      // Sized as a real control, not a caption: this gets tapped mid-set with
      // sweaty hands, so it carries its own border and a ~36px tall target
      // rather than sitting flush with the tempo/notes text beside it.
      className={
        isMine
          ? "flex-row items-center gap-1.5 rounded-lg border bg-brand-primary-soft px-3 py-2"
          : "flex-row items-center gap-1.5 rounded-lg border px-3 py-2"
      }
      // Border colour inline, not `border-brand-secondary/40`: the /opacity
      // modifier doesn't compile under react-native-css (same reason the
      // thumbnail overlay above uses inline rgba).
      style={{ borderColor: isMine ? colors.brandPrimary : colors.border }}
    >
      <Ionicons
        name={isMine ? "hourglass-outline" : "play-circle"}
        size={17}
        color={isMine ? colors.brandPrimary : colors.brandSecondary}
      />
      <Text
        className={
          isMine
            ? "text-[13px] font-bold text-brand-primary"
            : "text-[13px] font-bold text-brand-secondary"
        }
      >
        {t("program.restLabel", { seconds })}
      </Text>
    </Pressable>
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
  return (
    <View className="flex-row items-center gap-1">
      <Ionicons name={icon} size={11} color={colors.contentMuted} />
      <Text className="text-[11px] text-content-tertiary">{children}</Text>
    </View>
  );
}
