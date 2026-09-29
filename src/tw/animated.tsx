import React from "react";
import { Pressable as RNPressable } from "react-native";
import RNAnimated from "react-native-reanimated";

import { useCssElement } from "./css";

// className-aware reanimated primitives. Same useCssElement pattern as
// AnimatedScrollView in ./index — the css hook wraps the animated component,
// so entering/exiting/layout and animated styles work alongside className.

const RAnimatedPressable = RNAnimated.createAnimatedComponent(RNPressable);

type WithClassName<T> = T & { className?: string };

export function AnimatedView(
  props: WithClassName<React.ComponentProps<typeof RNAnimated.View>>,
) {
  return useCssElement(RNAnimated.View, props, { className: "style" });
}
AnimatedView.displayName = "CSS(Animated.View)";

export function AnimatedPressable(
  props: WithClassName<React.ComponentProps<typeof RAnimatedPressable>>,
) {
  return useCssElement(RAnimatedPressable, props, { className: "style" });
}
AnimatedPressable.displayName = "CSS(Animated.Pressable)";

// Same default face as the tw Text: RN doesn't inherit font-family, so
// `font-app` is set per element and any explicit font-* class overrides it.
export function AnimatedText(
  props: WithClassName<React.ComponentProps<typeof RNAnimated.Text>>,
) {
  return useCssElement(
    RNAnimated.Text,
    { ...props, className: props.className ? `font-app ${props.className}` : "font-app" },
    { className: "style" },
  );
}
AnimatedText.displayName = "CSS(Animated.Text)";
