import * as Haptics from "expo-haptics";
import { useNavigationState } from "expo-router/react-navigation";
import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable as RNPressable } from "react-native";
import RNAnimated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInLeft,
  FadeInRight,
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

import { AnimatedPressable, AnimatedView } from "@/src/tw/animated";

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

// Reanimated's web entrances are CSS animations whose name it never clears,
// and a browser restarts every named animation under an element that comes
// back from display:none: a stack scene you return to, a tab you revisit. So
// fades that already ran would replay on top of the scene's own transition.
// Clear an entrance's name once it finishes (the end state is the element's
// own style, so nothing moves). Exits are left alone: Reanimated removes them.
const ENTRANCE = /^(FadeIn|ZoomIn|SlideIn)/;
if (IS_WEB && typeof document !== "undefined") {
  document.addEventListener(
    "animationend",
    (e) => {
      if (ENTRANCE.test(e.animationName) && e.target instanceof HTMLElement) {
        e.target.style.animationName = "";
      }
    },
    true,
  );
}

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
// Content swapped in place (segmented panes, week/day pickers): a fade with a
// 16px drift from the side of travel. Reads which way you moved without the
// full-width slide a screen push uses.
export const swapEnter = (direction: 1 | -1) =>
  IS_WEB
    ? FadeIn.duration(DUR.base).easing(EASE_OUT)
    : (direction === 1 ? FadeInRight : FadeInLeft)
        .duration(DUR.base)
        .easing(EASE_OUT)
        .withInitialValues({ opacity: 0, transform: [{ translateX: 16 * direction }] });
// Loaders wait a beat before showing, so a fetch that lands quickly never
// flashes a spinner.
export const loaderEnter = () => FadeIn.duration(DUR.base).delay(DUR.fast).easing(EASE_OUT);

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

type Entering = AnimatedViewProps["entering"];

type SwapProps = {
  /** What is showing. A new id re-mounts the children with an entrance. */
  id: string | number;
  /** Position of `id` among its siblings (segment index, week number). A
   *  higher one drifts in from the right, a lower one from the left; without
   *  it the swap is a plain fade. */
  order?: number;
  className?: string;
  children: React.ReactNode;
};

/**
 * Content that changes in place: a segmented pane, the selected week or day.
 * Only changes animate. What shows at mount arrives with its screen, so a
 * Swap never doubles up the screen's own entrance. Re-mounting resets state
 * inside, so keep long-lived state (open sheets, inputs) outside it.
 */
export function Swap({ id, order, className, children }: SwapProps) {
  const [shown, setShown] = useState<{ id: string | number; order?: number; entering: Entering }>(
    { id, order, entering: undefined },
  );
  // Derived during render (React's "adjust state on prop change" pattern), so
  // the new content's first frame already has its entrance.
  if (shown.id !== id) {
    const direction = order != null && shown.order != null && order < shown.order ? -1 : 1;
    setShown({ id, order, entering: order != null ? swapEnter(direction) : enterFade() });
  }
  return (
    <AnimatedView key={id} entering={shown.entering} className={className}>
      {children}
    </AnimatedView>
  );
}

/**
 * Collapsible content. Opening animates; content already open at mount (a
 * day not finished yet) just renders. Closing is instant: an exit would fade
 * a ghost while the cards below jump up through it.
 */
export function Reveal({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [wasClosed, setWasClosed] = useState(!open);
  if (!open && !wasClosed) setWasClosed(true);
  if (!open) return null;
  return (
    <AnimatedView entering={wasClosed ? enter() : undefined} className={className}>
      {children}
    </AnimatedView>
  );
}

/**
 * Entrance for content that replaces a loader. It fades in only if the loader
 * actually showed. Content that was ready at mount (the persisted cache)
 * arrives with its screen instead of fading in a second time.
 */
export function useArrival(pending: boolean): Entering {
  const [waited, setWaited] = useState(pending);
  if (pending && !waited) setWaited(true);
  return waited ? enterFade() : undefined;
}

// Stacks (by navigator state key) whose first render has committed. Every
// scene in that first render arrives with the parent, including a deep link
// that mounts [index, create]; later pushes and pops fade.
const mountedStacks = new Set<string>();

// On web the native stack swaps screens with display:none/flex and no
// transition at all, so each scene fades in when it becomes the top of its
// own stack (push and back alike). Keyed to the stack's own index, not
// focus: a tab switch is already animated by the tab navigator and must not
// fade the scene a second time. In a nested stack the scenes of its first
// render also skip their mount fade: they arrive with whatever brought the
// stack in (a tab's first visit, the parent scene's own fade), and two fades
// multiplied read as one slow one.
function WebSceneFade({
  routeKey,
  nested,
  children,
}: {
  routeKey: string;
  nested: boolean;
  children: React.ReactNode;
}) {
  const stackKey = useNavigationState((s) => s.key);
  const isTop = useNavigationState((s) => s.routes[s.index]?.key === routeKey);
  const [arrivesWithParent] = useState(() => nested && !mountedStacks.has(stackKey));
  // Its own effect, not the fade's: that one returns early for scenes that
  // aren't on top, and the stack must be recorded either way.
  useEffect(() => {
    mountedStacks.add(stackKey);
  }, [stackKey]);
  const opacity = useSharedValue(arrivesWithParent ? 1 : 0);
  const mounting = useRef(true);
  useEffect(() => {
    const atMount = mounting.current;
    mounting.current = false;
    if (!isTop || (atMount && arrivesWithParent)) return;
    opacity.set(0);
    opacity.set(withTiming(1, { duration: DUR.base, easing: EASE_OUT }));
  }, [isTop, arrivesWithParent, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <RNAnimated.View style={[{ flex: 1 }, style]}>{children}</RNAnimated.View>;
}

type SceneLayoutProps = { route: { key: string }; children: React.ReactNode };

/**
 * `screenLayout` for the root Stack (app/_layout.tsx). Native stacks keep
 * their platform transitions (undefined there); on web every scene fades in,
 * including group switches (sign-in -> tabs).
 */
export const stackScreenLayout = IS_WEB
  ? ({ route, children }: SceneLayoutProps) => (
      <WebSceneFade routeKey={route.key} nested={false}>
        {children}
      </WebSceneFade>
    )
  : undefined;

/** `screenLayout` for Stacks nested in a group or a tab. See WebSceneFade. */
export const nestedStackScreenLayout = IS_WEB
  ? ({ route, children }: SceneLayoutProps) => (
      <WebSceneFade routeKey={route.key} nested>
        {children}
      </WebSceneFade>
    )
  : undefined;
