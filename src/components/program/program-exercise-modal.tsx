import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Modal, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProgramSetLogger } from "@/src/components/program/program-set-logger";
import { Button } from "@/src/components/ui";
import type { useProgramLogging } from "@/src/hooks/use-program-logging";
import { useColors } from "@/src/theme/colors";
import { Pressable, ScrollView, Text, View } from "@/src/tw";
import type { ProgramExercise, ProgramWeek } from "@/src/types/database";
import {
  effectivePrescription,
  formatLoadPct,
  formatReps,
  formatRir,
} from "@/src/utils/program";

const TABULAR = { fontVariant: ["tabular-nums" as const] };

type Props = {
  exercise: ProgramExercise | null;
  week: ProgramWeek | null;
  weekNumber: number;
  logging: ReturnType<typeof useProgramLogging>;
  onClose: () => void;
  onPlay: (uri: string) => void;
};

// Tap an exercise → this bottom sheet opens with the full prescription, the
// demo-video shortcut, a done toggle, and the per-set logger. Controlled by
// `exercise` presence (null = hidden).
export function ProgramExerciseModal({
  exercise,
  week,
  weekNumber,
  logging,
  onClose,
  onPlay,
}: Props) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const p = exercise != null ? effectivePrescription(exercise, week) : null;
  const done = exercise != null && logging.isDone(exercise.id, weekNumber);
  const videoUrl = exercise?.exercise?.video_url ?? null;
  const hasVideo = videoUrl != null && videoUrl !== "";

  // Step-by-step "how to" in the app language, falling back to the other.
  const cat = exercise?.exercise;
  const steps =
    (i18n.language === "es" ? cat?.instructions_es : cat?.instructions_en) ??
    cat?.instructions_en ??
    cat?.instructions_es ??
    null;
  // Collapsed by default — tap the header to reveal the steps.
  const [showSteps, setShowSteps] = React.useState(false);

  const loadPct = p != null ? formatLoadPct(p) : null;
  const rir = p != null ? formatRir(p) : null;
  const qual =
    p != null && p.loadPct == null && p.loadQualitative != null
      ? t(`program.load_${p.loadQualitative}`)
      : null;

  return (
    <Modal
      visible={exercise != null}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      {/* Backdrop — tap to dismiss */}
      <Pressable
        onPress={onClose}
        accessibilityLabel={t("common.close")}
        className="flex-1"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="absolute inset-x-0 bottom-0"
      >
        <View
          className="rounded-t-3xl bg-surface"
          style={{ paddingBottom: insets.bottom + 12, maxHeight: "88%" }}
        >
          {/* Grabber + header */}
          <View className="items-center pt-2.5">
            <View className="h-1 w-10 rounded-full bg-border-strong" />
          </View>
          {p != null && exercise != null && (
            <>
              <View className="flex-row items-start gap-3 px-5 pt-3 pb-2">
                <View className="flex-1">
                  <Text className="text-lg font-bold text-content-primary">{p.name}</Text>
                  <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1 pt-1.5">
                    <Text className="text-[15px] font-semibold text-content-secondary" style={TABULAR}>
                      {p.isUnilateral
                        ? t("program.setsRepsPerSide", { sets: p.sets, reps: formatReps(p.repMin, p.repMax) })
                        : t("program.setsReps", { sets: p.sets, reps: formatReps(p.repMin, p.repMax) })}
                    </Text>
                    {loadPct != null && <Chip tone="info">{loadPct}</Chip>}
                    {qual != null && <Chip tone="muted">{qual}</Chip>}
                    {rir != null && <Chip tone="accent">{rir}</Chip>}
                  </View>
                </View>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel={t("common.close")}
                  hitSlop={8}
                  className="h-8 w-8 items-center justify-center rounded-full bg-brand-dark"
                >
                  <Ionicons name="close" size={18} color={colors.contentSecondary} />
                </Pressable>
              </View>

              {(p.tempo != null || p.restSeconds != null || p.notes != null) && (
                <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-1">
                  {p.tempo != null && (
                    <Meta icon="time-outline">{t("program.tempoLabel", { tempo: p.tempo })}</Meta>
                  )}
                  {p.restSeconds != null && (
                    <Meta icon="pause-outline">{t("program.restLabel", { seconds: p.restSeconds })}</Meta>
                  )}
                  {p.notes != null && p.notes !== "" && (
                    <Text className="text-xs text-content-tertiary">{p.notes}</Text>
                  )}
                </View>
              )}

              <ScrollView
                className="px-5"
                contentContainerClassName="gap-3 pt-2 pb-3"
                keyboardShouldPersistTaps="handled"
              >
                {hasVideo && (
                  <Button variant="secondary" icon="play" onPress={() => onPlay(videoUrl)}>
                    {t("program.watchDemoShort")}
                  </Button>
                )}

                {steps != null && steps.length > 0 && (
                  <View className="rounded-2xl border border-border bg-brand-dark p-3.5">
                    <Pressable
                      onPress={() => setShowSteps((v) => !v)}
                      accessibilityRole="button"
                      accessibilityLabel={t("program.howTo")}
                      accessibilityState={{ expanded: showSteps }}
                      className="flex-row items-center justify-between"
                    >
                      <Text
                        className="text-[11px] font-bold uppercase text-content-tertiary"
                        style={{ letterSpacing: 0.6 }}
                      >
                        {t("program.howTo")}
                      </Text>
                      <View className="flex-row items-center gap-1.5">
                        <Text className="text-[11px] font-semibold text-content-muted" style={TABULAR}>
                          {steps.length}
                        </Text>
                        <Ionicons
                          name={showSteps ? "chevron-up" : "chevron-down"}
                          size={16}
                          color={colors.contentMuted}
                        />
                      </View>
                    </Pressable>
                    {showSteps && (
                      <View className="gap-2 pt-3">
                        {steps.map((step, i) => (
                          <View key={i} className="flex-row gap-2.5">
                            <View className="mt-0.5 h-5 w-5 items-center justify-center rounded-full bg-brand-primary-soft">
                              <Text className="text-[11px] font-bold text-brand-primary" style={TABULAR}>
                                {i + 1}
                              </Text>
                            </View>
                            <Text className="flex-1 text-[13px] leading-[19px] text-content-secondary">
                              {step}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                <ProgramSetLogger
                  prescribedSets={p.sets}
                  repMin={p.repMin}
                  repMax={p.repMax}
                  rirMin={p.rirMin}
                  rirMax={p.rirMax}
                  logged={logging.setsFor(exercise.id, weekNumber)}
                  onLogSet={(setIndex, input) =>
                    logging.logSet(exercise.id, weekNumber, setIndex, input)
                  }
                />

                <Button
                  variant={done ? "secondary" : "primary"}
                  icon={done ? "checkmark-circle" : "ellipse-outline"}
                  onPress={() => logging.setCompletion(exercise.id, weekNumber, !done)}
                >
                  {t(done ? "program.markedDone" : "program.markDoneCta")}
                </Button>
              </ScrollView>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone: "info" | "accent" | "muted" }) {
  const cls =
    tone === "info" ? "bg-info-soft" : tone === "accent" ? "bg-brand-accent-soft" : "bg-surface-elevated";
  const textCls =
    tone === "info"
      ? "text-brand-secondary"
      : tone === "accent"
        ? "text-brand-accent"
        : "text-content-tertiary";
  return (
    <View className={`rounded-md px-2 py-0.5 ${cls}`}>
      <Text className={`text-xs font-semibold ${textCls}`} style={TABULAR}>
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
  return (
    <View className="flex-row items-center gap-1">
      <Ionicons name={icon} size={12} color={colors.contentMuted} />
      <Text className="text-xs text-content-tertiary">{children}</Text>
    </View>
  );
}
