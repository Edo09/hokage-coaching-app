import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { DUR, EASE_OUT } from "@/src/lib/motion";
import { useColors } from "@/src/theme/colors";
import { Pressable, View } from "@/src/tw";
import { AnimatedText, AnimatedView } from "@/src/tw/animated";
import { cn } from "@/src/utils/cn";

export type Segment = {
  key: string;
  label: string;
  /** Optional count badge shown after the label (hidden when 0). */
  count?: number;
};

type Props = {
  segments: Segment[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
};

const SKEW = "-10deg";
const BADGE_ON_BLOCK = "rgba(0, 0, 0, 0.25)";

// Dojo Poster segmented control: bordered track (radius 10–12), active
// segment = red skew block with caps label; count badges are sharp
// rectangles. The block slides to the picked segment, so the press answers
// at once while the content below swaps.
export function SegmentedControl({ segments, value, onChange, className }: Props) {
  const colors = useColors();
  const activeIndex = segments.findIndex((s) => s.key === value);
  // Inner row width; 0 until measured. Until then the active segment paints
  // its own block, so the first frame is never missing its active state.
  const [rowWidth, setRowWidth] = useState(0);
  const segmentWidth = segments.length > 0 ? rowWidth / segments.length : 0;
  const slides = segmentWidth > 0 && activeIndex >= 0;
  // Block position in segments (0 = first), not pixels. It starts on the
  // active segment, so the first placement needs no measuring round-trip, and
  // a resize rescales through segmentWidth at once: only selections glide.
  const pos = useSharedValue(Math.max(activeIndex, 0));

  useEffect(() => {
    if (activeIndex < 0) return;
    pos.set(slides ? withTiming(activeIndex, { duration: DUR.base, easing: EASE_OUT }) : activeIndex);
  }, [activeIndex, slides, pos]);

  const blockStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pos.get() * segmentWidth }, { skewX: SKEW }],
  }));

  return (
    <View className={cn("rounded-xl bg-brand-dark border border-border p-1", className)}>
      <View className="flex-row" onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
        {slides && (
          <Animated.View
            style={[
              {
                // style, not the prop: react-native-web deprecates props.pointerEvents
                pointerEvents: "none",
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width: segmentWidth,
                backgroundColor: colors.brandPrimary,
              },
              blockStyle,
            ]}
          />
        )}
        {segments.map((seg, index) => (
          <SegmentButton
            key={seg.key}
            segment={seg}
            index={index}
            active={index === activeIndex}
            slides={slides}
            pos={pos}
            onPress={() => {
              if (index !== activeIndex) {
                Haptics.selectionAsync().catch(() => {});
                onChange(seg.key);
              }
            }}
          />
        ))}
      </View>
    </View>
  );
}

function SegmentButton({
  segment,
  index,
  active,
  slides,
  pos,
  onPress,
}: {
  segment: Segment;
  index: number;
  active: boolean;
  slides: boolean;
  pos: SharedValue<number>;
  onPress: () => void;
}) {
  const { white, contentMuted, contentTertiary, surface } = useColors();
  // While the block slides, a label is white only as far as the block sits
  // under it: switching colour on `active` alone would turn the tapped label
  // white on the pale light-mode track before the block got there.
  // 1 = block right under this segment, 0 = a segment or more away.
  const onBlock = (blockPos: number) => {
    "worklet";
    return slides ? 1 - Math.min(1, Math.abs(blockPos - index)) : active ? 1 : 0;
  };
  // Each style reads pos.get() itself: Reanimated subscribes to the shared
  // values an updater closes over, not to ones reached through a helper.
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(onBlock(pos.get()), [0, 1], [contentMuted, white]),
  }));
  const countStyle = useAnimatedStyle(() => ({
    color: interpolateColor(onBlock(pos.get()), [0, 1], [contentTertiary, white]),
  }));
  const badgeStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(onBlock(pos.get()), [0, 1], [surface, BADGE_ON_BLOCK]),
  }));
  const ownBlock = active && !slides;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      className={cn("flex-1 py-2.5", ownBlock && "bg-brand-primary")}
      style={ownBlock ? { transform: [{ skewX: SKEW }] } : undefined}
    >
      <View
        className="flex-row items-center justify-center gap-1.5"
        style={ownBlock ? { transform: [{ skewX: "10deg" }] } : undefined}
      >
        <AnimatedText
          className="font-extrabold uppercase"
          style={[{ fontSize: 10.5, letterSpacing: 1 }, labelStyle]}
          numberOfLines={1}
        >
          {segment.label}
        </AnimatedText>
        {segment.count != null && segment.count > 0 && (
          <AnimatedView className="min-w-5 items-center px-1.5 py-0.5" style={badgeStyle}>
            <AnimatedText
              className="text-xs font-bold"
              style={[{ fontVariant: ["tabular-nums"] }, countStyle]}
            >
              {segment.count}
            </AnimatedText>
          </AnimatedView>
        )}
      </View>
    </Pressable>
  );
}
