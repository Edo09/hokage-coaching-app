import React, { useEffect } from "react";
import {
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { EASE_OUT } from "@/src/lib/motion";
import { View } from "@/src/tw";
import { AnimatedView } from "@/src/tw/animated";

type BurstProps = {
  /** Bump to play once; 0 = idle. */
  play: number;
  /** Distance from the centre where the lines start and where they end, px. */
  from: number;
  to: number;
  /** Cycled across the lines. */
  colors: string[];
  count?: number;
  /** Line size, px. */
  length?: number;
  thickness?: number;
  /** Wait before flying, ms (e.g. to land on a stamp's impact). */
  delay?: number;
};

const DURATION = 460;

/**
 * Impact lines: short strokes flying out from a point, manga-style. The app's
 * answer to confetti. It fills its (relative) parent and draws from the
 * parent's centre, so wrap it around the thing that was just done. Plays once
 * each time `play` changes, and not at all under reduced motion.
 */
export function Burst({
  play,
  from,
  to,
  colors,
  count = 8,
  length = 9,
  thickness = 3,
  delay = 0,
}: BurstProps) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (play === 0 || reduced) return;
    progress.set(0);
    progress.set(withDelay(delay, withTiming(1, { duration: DURATION, easing: EASE_OUT })));
  }, [play, reduced, delay, progress]);

  if (play === 0 || reduced) return null;
  return (
    <View pointerEvents="none" className="absolute inset-0">
      {Array.from({ length: count }, (_, i) => (
        <Line
          key={i}
          progress={progress}
          // Half a step off the axes so no line points straight up.
          angle={(360 / count) * (i + 0.5)}
          // Every other line a little shorter and later-looking: reads as a
          // burst rather than a clock face.
          from={i % 2 === 0 ? from : from + 3}
          to={i % 2 === 0 ? to : to - 4}
          length={i % 2 === 0 ? length : length * 0.7}
          thickness={thickness}
          color={colors[i % colors.length]}
        />
      ))}
    </View>
  );
}

function Line({
  progress,
  angle,
  from,
  to,
  length,
  thickness,
  color,
}: {
  progress: SharedValue<number>;
  angle: number;
  from: number;
  to: number;
  length: number;
  thickness: number;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      // In fast, then fade over the rest of the flight.
      opacity: p === 0 ? 0 : p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85,
      // Rotate first so the translate runs along the line's own axis.
      transform: [
        { rotate: `${angle}deg` },
        { translateY: -(from + (to - from) * p) },
        { scaleY: 1 - 0.55 * p },
      ],
    };
  });
  return (
    <AnimatedView
      style={[
        {
          position: "absolute",
          left: "50%",
          top: "50%",
          width: thickness,
          height: length,
          marginLeft: -thickness / 2,
          marginTop: -length / 2,
          borderRadius: thickness / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}
