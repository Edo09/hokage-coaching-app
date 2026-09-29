import React, { useId } from "react";
import { useWindowDimensions } from "react-native";
import Svg, { Circle, Defs, G, LinearGradient, Mask, Pattern, Polygon, Rect, Stop } from "react-native-svg";

import { useColors } from "@/src/theme/colors";
import { useThemeScheme } from "@/src/theme/theme-store";

/** Height of the band, as a share of the window. */
const BAND_SHARE = 0.62;
/** Band width along its base, px. */
const BAND_W = 230;
/** The header ghost's lean (HeaderPanel: skewX(-18deg)). */
const LEAN = Math.tan((18 * Math.PI) / 180);
/** Halftone grid pitch and dot radius, px. */
const PITCH = 8;
const DOT_R = 1.5;

/**
 * Screentone slash: one diagonal band of halftone dots in faint brand red,
 * off the bottom-left of the page and fading out as it rises. It mirrors the
 * header panel's skewed ghost (top-right), so the two read as one diagonal
 * across the screen. Fixed behind the content, and only visible between
 * cards, which are opaque. Put it first in a page's root (it fills it).
 */
export function ScreentoneBackdrop() {
  const colors = useColors();
  const scheme = useThemeScheme();
  const { height } = useWindowDimensions();
  // DOM ids are global on web; colons from useId break url(#…).
  const id = useId().replace(/:/g, "");

  const h = Math.round(height * BAND_SHARE);
  const shift = LEAN * h;
  // Leaning "/" like skewX(-18deg): the top edge sits `shift` to the right.
  const points = `${-24 + shift},0 ${BAND_W + shift},0 ${BAND_W},${h} -24,${h}`;

  return (
    <Svg
      pointerEvents="none"
      width={BAND_W + shift + 8}
      height={h}
      style={{ position: "absolute", left: 0, bottom: 0 }}
    >
      <Defs>
        <Pattern id={`${id}-dots`} patternUnits="userSpaceOnUse" width={PITCH} height={PITCH}>
          <Circle cx={PITCH / 2} cy={PITCH / 2} r={DOT_R} fill={colors.brandPrimary} />
        </Pattern>
        {/* Dense at the base, gone by the top. */}
        <LinearGradient id={`${id}-fade`} x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor="#fff" stopOpacity={1} />
          <Stop offset="1" stopColor="#fff" stopOpacity={0} />
        </LinearGradient>
        <Mask id={`${id}-mask`}>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}-fade)`} />
        </Mask>
      </Defs>
      <G mask={`url(#${id}-mask)`} opacity={scheme === "dark" ? 0.34 : 0.2}>
        <Polygon points={points} fill={`url(#${id}-dots)`} />
      </G>
    </Svg>
  );
}
