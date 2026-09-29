import { Ionicons } from "@expo/vector-icons";
import React, { useEffect } from "react";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { DUR, EASE_OUT } from "@/src/lib/motion";

type Props = {
  open: boolean;
  size: number;
  color: string;
};

// Expand/collapse affordance: one chevron that turns, instead of swapping
// chevron-down for chevron-up, so the toggle reads as the same control moving.
export function ExpandChevron({ open, size, color }: Props) {
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.set(withTiming(open ? 1 : 0, { duration: DUR.base, easing: EASE_OUT }));
  }, [open, turn]);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.get() * 180}deg` }],
  }));
  return (
    <Animated.View style={style}>
      <Ionicons name="chevron-down" size={size} color={color} />
    </Animated.View>
  );
}
