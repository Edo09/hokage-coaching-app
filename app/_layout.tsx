import "@/src/global.css";
import { GluestackUIProvider } from "@/components/ui/gluestack-ui-provider";
import { OfflineBanner } from "@/src/components/offline-banner";
import { ToastProvider } from "@/src/components/ui";
import { useAuth } from "@/src/hooks/use-auth";
import i18n from "@/src/i18n";
import { setupOnlineManager } from "@/src/lib/online";
import { flushOutbox } from "@/src/lib/outbox";
import { persister, PERSIST_MAX_AGE, queryClient } from "@/src/lib/query-client";
import { setupRestAlerts } from "@/src/lib/rest-alert";
import { AuthProvider } from "@/src/providers/auth-provider";
import { CelebrationProvider } from "@/src/providers/celebration-provider";
import { RestTimerProvider } from "@/src/providers/rest-timer-provider";
import { useColors } from "@/src/theme/colors";
import { WEB_MAX_WIDTH } from "@/src/theme/layout";
import { applyThemeMode, getStoredThemeMode } from "@/src/theme/theme-mode";
import { useThemeMode } from "@/src/theme/theme-store";
import { supabase } from "@/src/utils/supabase";
import { Anton_400Regular } from "@expo-google-fonts/anton";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
} from "@expo-google-fonts/inter";
import { focusManager } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { AppState, Platform, View } from "react-native";
import Constants from "expo-constants";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect } from "react";
import { I18nextProvider } from "react-i18next";

SplashScreen.preventAutoHideAsync();

// react-query has no "window focus" in RN — drive it from AppState so
// returning to the app refetches stale queries. Foregrounding also restarts
// the auth token refresh timer and retries any queued offline writes.
setupOnlineManager();
// Audio session, Android notification channel and the foreground notification
// handler for the rest timer. Module scope, not an effect: the notification
// handler has to be installed before any scheduled rest can fire.
setupRestAlerts();
AppState.addEventListener("change", (status) => {
  focusManager.setFocused(status === "active");
  if (status === "active") {
    supabase.auth.startAutoRefresh();
    void flushOutbox();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

function AuthGate() {
  const { session, loading, onboardingCompleted } = useAuth();
  const segments = useSegments();
  const router = useRouter();


  useEffect(() => {
    if (loading) return;
    // Wait until onboarding status is fetched for logged-in users
    if (session && onboardingCompleted === null) return;

    const inAuthGroup = (segments[0]) === "(auth)";
    const inOnboarding = (segments[0]) === "(onboarding)";
    const inTabs = (segments[0]) === "(tabs)";


    if (!session && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (session && !onboardingCompleted && !inOnboarding) {
      router.replace("/(onboarding)");
    } else if (session && onboardingCompleted && !inTabs) {
      router.replace("/(tabs)");
    }
  }, [session, loading, onboardingCompleted, segments, router]);

  return null;
}

export default function RootLayout() {
  const colors = useColors();
  const [fontsLoaded] = useFonts({
    Anton_400Regular,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
    // Display face for the brand wordmark only (matches the HOKAGE logo).
    // Register under the PostScript name so the fontFamily string resolves
    // on both platforms — see the `font-display` utility in global.css.
    EdoSZ: require("@/font/edo_sz/edosz.ttf"),
  });

  // Restore the saved theme before first paint (joins the splash gate with
  // font loading) so a dark-mode user never sees a light flash on cold start.
  // Store-backed (not local state) so later toggles re-render the provider —
  // on web its mode prop controls the OS media listener.
  const themeMode = useThemeMode();
  useEffect(() => {
    getStoredThemeMode()
      .then(applyThemeMode)
      // A theme failure must never gate `ready` — fall back and render.
      .catch(() => applyThemeMode("system"));
  }, []);

  const ready = fontsLoaded && themeMode !== null;

  useEffect(() => {
    if (Platform.OS === "web" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  const onLayoutRootView = useCallback(async () => {
    if (ready) {
      await SplashScreen.hideAsync();
    }
  }, [ready]);

  useEffect(() => {
    onLayoutRootView();
  }, [onLayoutRootView]);

  if (!ready) return null;

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE,
        // Cache-bust when the app version changes
        buster: Constants.expoConfig?.version ?? "0",
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => query.state.status === "success",
          // Writes are persisted by the outbox, not react-query
          shouldDehydrateMutation: () => false,
        },
      }}
      onSuccess={() => {
        // Cache restored — safe to drain writes queued before the restart
        void flushOutbox();
      }}
    >
      <I18nextProvider i18n={i18n}>
        <GluestackUIProvider mode={themeMode ?? "system"}>
          <AuthProvider>
          {/* Above the router: one rest timer app-wide, so a countdown started
              on an exercise survives navigating away from it. */}
          <RestTimerProvider>
          <ToastProvider>
          {/* Finishing a program day celebrates the same way from any screen. */}
          <CelebrationProvider>
            {/* "auto" tracks the active scheme: light icons on dark, dark on light */}
            <StatusBar style="auto" />
            <View
              style={{
                flex: 1,
                backgroundColor:
                  Platform.OS === "web" ? colors.webGutter : colors.brandDark,
              }}
            >
            <View
              style={[
                { flex: 1 },
                // Phone-first screens: on web render the whole app (tab bar
                // included) as a centered column instead of full-bleed.
                Platform.OS === "web" && {
                  width: "100%" as const,
                  maxWidth: WEB_MAX_WIDTH,
                  marginHorizontal: "auto" as const,
                  borderLeftWidth: 1,
                  borderRightWidth: 1,
                  borderColor: colors.border,
                },
              ]}
            >
              <OfflineBanner />
              {/* Group switches are router.replace calls — fade reads right */}
              <Stack
                screenOptions={{
                  headerShown: false,
                  animation: "fade",
                  animationDuration: 250,
                  // Native screen container — themed so transitions never
                  // flash white in dark mode
                  contentStyle: { backgroundColor: colors.brandDark },
                }}
              >
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(onboarding)" />
                <Stack.Screen name="(tabs)" />
              </Stack>
            </View>
            </View>
            <AuthGate />
          </CelebrationProvider>
            </ToastProvider>
          </RestTimerProvider>
          </AuthProvider>
        </GluestackUIProvider>
      </I18nextProvider>
    </PersistQueryClientProvider>
  );
}
