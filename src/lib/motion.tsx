import * as Haptics from "expo-haptics";
import React from "react";
import { Platform, Pressable as RNPressable } from "react-native";
import RNAnimated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  SlideInLeft,
  SlideInRight,
  ZoomIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { AnimatedPressable } from "@/src/tw/animated";

// App-wide motion language: quiet timing, no bounce. One easing family,
// three durations; entrances fade + rise 12px, exits fade fast, presses
// scale 0.97. Screens should import from here, not from reanimated.

export const DUR = { fast: 150, base: 250, slow: 400 } as const;
export const EASE_OUT = Easing.out(Easing.cubic);
export const EASE_IN = Easing.in(Easing.cubic);

// react-native-web's Reanimated implementation of TRANSFORM-based entering
// animations (FadeInDown's translateY, SlideIn*'s translateX, ZoomIn's scale)
// doesn't clean up its offset — the element stays shifted "out of place" after
// the animation. Opacity-only FadeIn/FadeOut are unaffected. So on web every
// transform entrance degrades to a plain fade; native keeps the full motion.
// (Same reason itemLayoutAnimation is already web-gated at the FlatList sites.)
const IS_WEB = Platform.OS === "web";

// Factories, not constants: builder methods like .delay() mutate the
// instance, so a shared const would leak delays between call sites.
export const enter = () =>
  IS_WEB
    ? FadeIn.duration(DUR.base).easing(EASE_OUT)
    : FadeInDown.duration(DUR.base)
        .easing(EASE_OUT)
        .withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] });

export const enterFade = () => FadeIn.duration(DUR.base).easing(EASE_OUT);
export const exit = () => FadeOut.duration(DUR.fast).easing(EASE_IN);
export const pop = () =>
  IS_WEB
    ? FadeIn.duration(DUR.fast).easing(EASE_OUT)
    : ZoomIn.duration(DUR.fast).easing(EASE_OUT);
export const slideEnter = (direction: 1 | -1) =>
  IS_WEB
    ? FadeIn.duration(DUR.base).easing(EASE_OUT)
    : (direction === 1 ? SlideInRight : SlideInLeft)
        .duration(DUR.base)
        .easing(EASE_OUT);
export const layout = () => LinearTransition.duration(DUR.base).easing(EASE_OUT);

// Stagger only the first few items; cells mounted later (FlatList windowing
// on scroll, refetch inserts) animate immediately instead of queueing.
export const STAGGER_MS = 40;
export const STAGGER_CAP = 6;
export const staggered = (index: number) =>
  enter().delay(index < STAGGER_CAP ? index * STAGGER_MS : 0);

// Typed off the plain RN Pressable: createAnimatedComponent's generated prop
// types wrap everything in SharedValue unions, which breaks callers.
type AnimatedViewProps = React.ComponentProps<typeof RNAnimated.View>;
type PressableScaleProps = React.ComponentProps<typeof RNPressable> & {
  className?: string;
  haptic?: boolean;
  scaleTo?: number;
  entering?: AnimatedViewProps["entering"];
  exiting?: AnimatedViewProps["exiting"];
};

/**
 * PressableScale's feedback, detached: for when the view that should shrink
 * isn't the pressable itself (e.g. a card whose tap target is a backdrop
 * behind its content). Put `style` on an animated view, wire the handlers to
 * the pressable.
 */
export function usePressScale(scaleTo = 0.97) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return {
    style,
    // .set(), not .value=: React Compiler flags the assignment as an
    // illegal mutation (Reanimated added get/set for compiler compat)
    pressIn: () => scale.set(withTiming(scaleTo, { duration: 100, easing: EASE_OUT })),
    pressOut: () => scale.set(withTiming(1, { duration: DUR.fast, easing: EASE_OUT })),
  };
}

/**
 * A quick dip-overshoot-settle for something that just switched on (a check,
 * a logged set). Put `style` on an animated view and call `pop()` on the
 * change. Does nothing under reduced motion.
 */
export function usePop() {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return {
    style,
    pop: () => {
      if (reduced) return;
      scale.set(
        withSequence(
          withTiming(0.75, { duration: 70, easing: EASE_OUT }),
          withTiming(1.18, { duration: 130, easing: EASE_OUT }),
          withTiming(1, { duration: DUR.fast, easing: EASE_OUT }),
        ),
      );
    },
  };
}

/** Pressable with scale-down feedback; the app's standard press affordance. */
export function PressableScale({
  haptic = false,
  scaleTo = 0.97,
  style,
  onPress,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const press = usePressScale(scaleTo);
  return (
    <AnimatedPressable
      {...rest}
      style={[style, press.style]}
      onPressIn={(e) => {
        press.pressIn();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        press.pressOut();
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) Haptics.selectionAsync().catch(() => {});
        onPress?.(e);
      }}
    />
  );
}
