import { Ionicons } from "@expo/vector-icons";
import { router, Tabs } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { useColors } from "@/src/theme/colors";
import { Pressable } from "@/src/tw";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

// Dojo Poster tab item: 3×20px red tick above the active icon (the tick,
// not color alone, signals the active tab), icon 23px.
function TabIcon({ name, focused }: { name: IoniconName; focused: boolean }) {
  const colors = useColors();
  return (
    <View style={{ alignItems: "center", gap: 3 }}>
      <View
        style={{
          width: 20,
          height: 3,
          borderRadius: 2,
          backgroundColor: focused ? colors.brandPrimary : "transparent",
        }}
      />
      <Ionicons name={name} size={23} color={focused ? colors.brandPrimary : colors.contentMuted} />
    </View>
  );
}

export default function TabsLayout() {
  const colors = useColors();
  const { t } = useTranslation();
  return (
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
        name="meals"
        options={{
          title: t("tabs.meals"),
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
  );
}
