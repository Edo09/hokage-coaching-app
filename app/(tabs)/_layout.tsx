import { Ionicons } from "@expo/vector-icons";
import { router, Tabs, useIsFocused } from "expo-router";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Platform, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { AppMenu } from "@/src/components/app-menu";
import { CheckCardHost } from "@/src/components/program/check-card";
import { ExerciseSessionHost } from "@/src/components/program/exercise-session-host";
import { RestTimerBar } from "@/src/components/program/rest-timer-bar";
import { TabHeader } from "@/src/components/ui";
import { useAuth } from "@/src/hooks/use-auth";
import { useReminderSync } from "@/src/hooks/use-reminder-sync";
import { useReminderTaps } from "@/src/hooks/use-reminder-taps";
import { DUR, EASE_OUT } from "@/src/lib/motion";
import { useColors } from "@/src/theme/colors";
import { Pressable } from "@/src/tw";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

// Dojo Poster tab item: 3×20px red tick above the active icon (the tick,
// not color alone, signals the active tab), icon 23px. The tick draws out
// from its centre as the tab gains focus, in step with the scene's shift.
// The bar renders each icon twice (a focused and an unfocused copy, swapped
// by opacity), so `focused` never changes for a copy: the tick follows the
// tab's real focus instead, and `focused` only picks the copy's colour.
function TabIcon({ name, focused }: { name: IoniconName; focused: boolean }) {
  const colors = useColors();
  const tabFocused = useIsFocused();
  const tick = useSharedValue(tabFocused ? 1 : 0);
  useEffect(() => {
    tick.set(withTiming(tabFocused ? 1 : 0, { duration: DUR.fast, easing: EASE_OUT }));
  }, [tabFocused, tick]);
  const tickStyle = useAnimatedStyle(() => ({
    opacity: tick.get(),
    transform: [{ scaleX: tick.get() }],
  }));
  return (
    <View style={{ alignItems: "center", gap: 3 }}>
      <Animated.View
        style={[
          { width: 20, height: 3, borderRadius: 2, backgroundColor: colors.brandPrimary },
          tickStyle,
        ]}
      />
      <Ionicons name={name} size={23} color={focused ? colors.brandPrimary : colors.contentMuted} />
    </View>
  );
}

// Perfil's tab header: the account's name as context (same name as home's
// greeting), and the "⋮" menu (settings, sign out) on the right.
function ProfileHeader() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const name =
    (user?.user_metadata?.display_name as string | undefined) ?? user?.email?.split("@")[0] ?? null;
  return <TabHeader title={t("tabs.profile")} context={name} right={<AppMenu />} />;
}

// Local reminders: keeps the next 14 days scheduled and opens Programa when
// one is tapped. Here because both need a signed-in, onboarded client, which
// AuthGate has settled on once the tabs mount. Its own component, rendering
// nothing, so the re-renders its data causes (every check-off, every refetch)
// stay off the tab navigator.
function Reminders() {
  useReminderSync();
  useReminderTaps();
  return null;
}

export default function TabsLayout() {
  const colors = useColors();
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        animation: "shift",
        // Native scene container — themed so tab switches never flash
        // white in dark mode
        sceneStyle: { backgroundColor: colors.brandDark },
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.contentMuted,
        tabBarStyle: {
          backgroundColor: colors.brandDark,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 74,
        },
        tabBarItemStyle: { paddingTop: 6 },
        tabBarLabelStyle: {
          fontSize: 9,
          fontFamily: "Inter_700Bold",
          letterSpacing: 0.72,
          textTransform: "uppercase",
        },
        headerStyle: { backgroundColor: colors.brandDark },
        headerTintColor: colors.contentPrimary,
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.home"),
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="routines"
        options={{
          title: t("tabs.program"),
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon name="barbell" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="nutrition"
        options={{
          title: t("tabs.nutrition"),
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon name="restaurant" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: t("tabs.progress"),
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon name="bar-chart" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("tabs.profile"),
          tabBarIcon: ({ focused }) => <TabIcon name="person" focused={focused} />,
          header: () => <ProfileHeader />,
        }}
      />
      {/* Reached from the home menu, not the tab bar (href: null hides it).
          Tabs headers have no native back button — provide one. */}
      <Tabs.Screen
        name="settings"
        options={{
          href: null,
          title: t("settings.title"),
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel={t("common.back")}
              className="pl-3 pr-2 py-1"
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={24} color={colors.contentPrimary} />
            </Pressable>
          ),
        }}
      />
    </Tabs>
    {/* Floats clear of the 74px tab bar. Rendered here, not per screen, so the
        countdown keeps running while the client moves around the app. */}
    <RestTimerBar bottom={74} />
    {/* The card that answers a check-off, above both bars when they show. */}
    <CheckCardHost bottom={74} />
    {/* The exercise in progress: its sheet, or its bar above the rest bar. */}
    <ExerciseSessionHost tabBarHeight={74} />
    {/* Web has no local notifications. */}
    {Platform.OS !== "web" && <Reminders />}
    </View>
  );
}
