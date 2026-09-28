import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Body, { type ExtendedBodyPart, type Slug } from "react-native-body-highlighter";

import type { MuscleMapView } from "@/src/lib/muscle-map-view";
import { useColors } from "@/src/theme/colors";
import { Text, View } from "@/src/tw";
import {
  isWeakGroup,
  type MuscleAlert,
  type MuscleGroup,
  type MuscleRow,
  type MuscleWeek,
} from "@/src/utils/progress";

export type DrawnGroup = Exclude<MuscleGroup, "other">;

/** Drawn muscles per display group — utils/progress.ts collapses the
 *  catalog's body parts into these six. The drawing has no abductors, and
 *  "other" (neck, cardio) has nothing to shade. */
export const GROUP_SLUGS: Record<DrawnGroup, Slug[]> = {
  chest: ["chest"],
  back: ["trapezius", "upper-back", "lower-back"],
  shoulders: ["deltoids"],
  arms: ["biceps", "triceps", "forearm"],
  core: ["abs", "obliques"],
  legs: ["quadriceps", "hamstring", "gluteal", "adductors", "calves", "tibialis"],
};
const SLUG_GROUP = new Map<Slug, DrawnGroup>(
  (Object.entries(GROUP_SLUGS) as [DrawnGroup, Slug[]][]).flatMap(([group, slugs]) =>
    slugs.map((slug) => [slug, group] as const),
  ),
);
/** Not muscles: drawn quieter so the muscles read first. */
export const NON_MUSCLE: Slug[] = ["head", "hair", "neck", "hands", "feet", "knees", "ankles"];

// The drawing is 200 × 400 at scale 1, in a 724-unit-wide viewBox.
const BASE_W = 200;
const VIEWBOX_W = 724;
/** Gap between the front and back figures, and the widest a figure gets. */
const GAP = 16;
const MAX_FIGURE_W = 140;

/** "#rrggbb" + alpha → rgba(). */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** The volume legend's steps, lightest to strongest: untrained, then 3 heat levels. */
function heatScale(brand: string, untrained: string): string[] {
  return [untrained, withAlpha(brand, 0.38), withAlpha(brand, 0.68), brand];
}

type MuscleHeatMapProps = {
  /** "week": this program week — sin asignar / asignado / trabajado.
   *  "volume": sets per group over the period, as a heat map. */
  mode: MuscleMapView;
  rows: MuscleRow[];
  alert: MuscleAlert | null;
  week: MuscleWeek | null;
  gender: "male" | "female";
  selected: MuscleGroup | null;
  onSelect: (group: MuscleGroup | null) => void;
};

/**
 * Front and back figures, in one of two views:
 *  - week: three colours — slate = not assigned this week, blue = assigned
 *    but not worked yet, red = worked (any set). Same scheme as the coach's
 *    muscle map in the panel.
 *  - volume: shaded by sets per group in the period — slate = none, three
 *    steps of brand red by share of the busiest group, amber = under a
 *    quarter of it (the bars' "weak" rule); the alert's group is outlined
 *    in amber.
 * The selected group is outlined in ink. Tapping a muscle selects its group
 * (again, or a non-muscle, clears).
 */
export function MuscleHeatMap({ mode, rows, alert, week, gender, selected, onSelect }: MuscleHeatMapProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);

  const figureW = Math.min(MAX_FIGURE_W, Math.max(0, (width - GAP) / 2));
  const scale = figureW / BASE_W;
  /** Outlines are in drawing units; this many make one screen pixel. */
  const unitsPerPx = figureW > 0 ? VIEWBOX_W / figureW : 1;

  const max = Math.max(...rows.map((r) => r.sets), 1);
  const bySet = new Map(rows.map((r) => [r.group, r]));
  const scaleColors = heatScale(colors.brandPrimary, colors.borderStrong);
  const weekColors = { unassigned: colors.borderStrong, assigned: colors.brandSecondary, worked: colors.brandPrimary };

  const fillFor = (group: DrawnGroup): string => {
    if (mode === "week") {
      if ((week?.done[group] ?? 0) > 0) return weekColors.worked;
      return (week?.assigned[group] ?? 0) > 0 ? weekColors.assigned : weekColors.unassigned;
    }
    const row = bySet.get(group);
    const sets = row?.sets ?? 0;
    if (sets === 0) return scaleColors[0];
    if (isWeakGroup(row!, max)) return colors.warning;
    const share = sets / max;
    return scaleColors[share > 2 / 3 ? 3 : share > 1 / 3 ? 2 : 1];
  };

  const data: ExtendedBodyPart[] = [];
  for (const [group, slugs] of Object.entries(GROUP_SLUGS) as [DrawnGroup, Slug[]][]) {
    const fill = fillFor(group);
    const outline =
      selected === group
        ? colors.contentPrimary
        : mode === "volume" && alert?.group === group
          ? colors.warning
          : null;
    for (const slug of slugs) {
      data.push({
        slug,
        styles: {
          fill,
          stroke: outline ?? "none",
          strokeWidth: outline != null ? 2 * unitsPerPx : 0,
        },
      });
    }
  }
  for (const slug of NON_MUSCLE) data.push({ slug, styles: { fill: colors.border } });

  // On web, react-native-svg fires onPress twice for one click (responder
  // release + click), which would toggle the selection straight back. A
  // repeat for the same part within a moment is the same tap.
  const lastPress = useRef({ slug: "", at: 0 });
  const press = (part: ExtendedBodyPart) => {
    const now = Date.now();
    if (part.slug === lastPress.current.slug && now - lastPress.current.at < 300) return;
    lastPress.current = { slug: part.slug ?? "", at: now };
    const group = part.slug != null ? SLUG_GROUP.get(part.slug) : undefined;
    onSelect(group != null && group !== selected ? group : null);
  };

  const anyWeak = rows.some((r) => isWeakGroup(r, max));
  const swatch = (color: string) => <View className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} className="gap-3">
      {figureW > 0 && (
        <View className="flex-row justify-center" style={{ gap: GAP }}>
          {(["front", "back"] as const).map((side) => (
            <View key={side} className="items-center gap-1.5">
              <Body
                data={data}
                gender={gender}
                side={side}
                scale={scale}
                border="none"
                defaultFill={colors.borderStrong}
                onBodyPartPress={press}
              />
              <Text className="text-[11px] text-content-muted">
                {side === "front" ? t("progress.mapaFrente") : t("progress.mapaEspalda")}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Legend: what the colours mean in this view */}
      <View className="flex-row flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
        {mode === "week" ? (
          (
            [
              [weekColors.unassigned, "progress.mapaSinAsignar"],
              [weekColors.assigned, "progress.mapaAsignado"],
              [weekColors.worked, "progress.mapaTrabajado"],
            ] as const
          ).map(([c, key]) => (
            <View key={key} className="flex-row items-center gap-1.5">
              {swatch(c)}
              <Text className="text-[11px] text-content-muted">{t(key)}</Text>
            </View>
          ))
        ) : (
          <>
            <View className="flex-row items-center gap-1.5">
              <Text className="text-[11px] text-content-muted">{t("progress.mapaMenos")}</Text>
              {scaleColors.map((c) => (
                <React.Fragment key={c}>{swatch(c)}</React.Fragment>
              ))}
              <Text className="text-[11px] text-content-muted">{t("progress.mapaMas")}</Text>
            </View>
            {anyWeak && (
              <View className="flex-row items-center gap-1.5">
                {swatch(colors.warning)}
                <Text className="text-[11px] text-content-muted">{t("progress.mapaPoco")}</Text>
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}
