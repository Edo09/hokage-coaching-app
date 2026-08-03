import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { kgToUnit1, unitToKg, useWeightUnit } from "@/src/lib/weight-unit";
import { useColors } from "@/src/theme/colors";
import { Text, TextInput, View } from "@/src/tw";
import type { WorkoutSetLog } from "@/src/types/database";
import type { SetInput } from "@/src/hooks/use-program-logging";

const TABULAR = { fontVariant: ["tabular-nums" as const] };

type Props = {
  prescribedSets: number;
  repMin: number | null;
  repMax: number | null;
  /** Coach-prescribed RIR for this week — shown read-only, never entered. */
  rirMin: number | null;
  rirMax: number | null;
  logged: WorkoutSetLog[];
  onLogSet: (setIndex: number, input: SetInput) => void;
};

/** The prescribed RIR as a bare value for the column ("2", "1–2", or "—"). */
function rirText(min: number | null, max: number | null): string {
  if (min == null && max == null) return "—";
  if (min != null && max != null) return min === max ? String(min) : `${min}–${max}`;
  return String(min ?? max);
}

// Optional per-set actuals for one exercise, for the viewed week. One row per
// prescribed set; weight is entered/shown in the user's unit (stored kg).
// Saving is per-field on blur — logging is independent of the done checkbox.
// RIR is the coach's target, so it's displayed, not captured.
export function ProgramSetLogger({
  prescribedSets,
  repMin,
  repMax,
  rirMin,
  rirMax,
  logged,
  onLogSet,
}: Props) {
  const { t } = useTranslation();
  const unit = useWeightUnit();
  const indexes = Array.from({ length: prescribedSets }, (_, i) => i + 1);
  const repPlaceholder = repMax != null ? String(repMax) : repMin != null ? String(repMin) : "—";
  const prescribedRir = rirText(rirMin, rirMax);

  return (
    <View className="mt-1 gap-1.5 rounded-lg bg-brand-dark px-3 py-2.5">
      <View className="flex-row items-center gap-2 pb-0.5">
        <Text className="w-10 text-[10px] font-bold uppercase text-content-muted" style={{ letterSpacing: 0.3 }}>
          {t("program.setCol")}
        </Text>
        <Text className="flex-1 text-[10px] font-bold uppercase text-content-muted" style={{ letterSpacing: 0.3 }}>
          {t("program.weightCol", { unit })}
        </Text>
        <Text className="flex-1 text-[10px] font-bold uppercase text-content-muted" style={{ letterSpacing: 0.3 }}>
          {t("program.repsCol")}
        </Text>
        <Text className="w-12 text-[10px] font-bold uppercase text-content-muted" style={{ letterSpacing: 0.3 }}>
          RIR
        </Text>
      </View>
      {indexes.map((i) => (
        <SetRow
          key={i}
          index={i}
          unit={unit}
          repPlaceholder={repPlaceholder}
          prescribedRir={prescribedRir}
          logged={logged.find((s) => s.set_index === i) ?? null}
          onSave={(input) => onLogSet(i, input)}
        />
      ))}
    </View>
  );
}

function SetRow({
  index,
  unit,
  repPlaceholder,
  prescribedRir,
  logged,
  onSave,
}: {
  index: number;
  unit: "kg" | "lb";
  repPlaceholder: string;
  prescribedRir: string;
  logged: WorkoutSetLog | null;
  onSave: (input: SetInput) => void;
}) {
  const colors = useColors();
  // Seed from the logged row (weight shown in the display unit).
  const [weight, setWeight] = useState(
    logged?.weight_kg != null ? String(kgToUnit1(logged.weight_kg, unit)) : "",
  );
  const [reps, setReps] = useState(logged?.reps != null ? String(logged.reps) : "");

  // Persist the current row; empty fields become null. Called on blur so a
  // single edit records the whole set (weight is stored in kg). RIR isn't
  // captured — it's the coach's target, not something the client reports.
  const save = () => {
    const w = parseFloat(weight.replace(",", "."));
    const r = parseInt(reps, 10);
    // Skip a fully-empty row (nothing to log yet).
    if (weight.trim() === "" && reps.trim() === "") return;
    onSave({
      weight_kg: Number.isNaN(w) ? null : Math.round(unitToKg(w, unit) * 10) / 10,
      reps: Number.isNaN(r) ? null : r,
    });
  };

  const inputCls =
    "flex-1 rounded-md bg-surface px-2 py-1.5 text-[13px] text-content-primary border border-border";

  return (
    <View className="flex-row items-center gap-2">
      <View className="w-10">
        <Text className="text-[12px] font-semibold text-content-tertiary" style={TABULAR}>
          {index}
        </Text>
      </View>
      <TextInput
        className={inputCls}
        keyboardType="decimal-pad"
        placeholder="—"
        placeholderTextColor={colors.contentMuted}
        value={weight}
        onChangeText={setWeight}
        onBlur={save}
        returnKeyType="done"
      />
      <TextInput
        className={inputCls}
        keyboardType="number-pad"
        placeholder={repPlaceholder}
        placeholderTextColor={colors.contentMuted}
        value={reps}
        onChangeText={setReps}
        onBlur={save}
        returnKeyType="done"
      />
      {/* Coach's target — read-only. */}
      <View className="w-12 items-center py-1.5">
        <Text className="text-[13px] font-semibold text-content-tertiary" style={TABULAR}>
          {prescribedRir}
        </Text>
      </View>
    </View>
  );
}
