import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Input, Screen } from "@/src/components/ui";
import { useAuth } from "@/src/hooks/use-auth";
import { setLanguage } from "@/src/i18n";
import { useIsOnline } from "@/src/lib/online";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";

export default function Login() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const online = useIsOnline();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const missingEmail = !email.trim();
    const missingPassword = !password;
    if (missingEmail || missingPassword) {
      setEmailError(missingEmail ? t("common.fieldRequired") : undefined);
      setPasswordError(missingPassword ? t("common.fieldRequired") : undefined);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    try {
      setLoading(true);
      setFormError(null);
      await signIn(email.trim(), password);
      router.replace("/(tabs)");
    } catch (e: any) {
      const isAuthError = typeof e?.message === "string" && /credential|invalid/i.test(e.message);
      setFormError(isAuthError ? t("auth.invalidCredentials") : t("common.somethingWentWrong"));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen keyboard contentContainerClassName="flex-1 justify-center px-6 py-12 gap-0">
      <Pressable
        onPress={() => setLanguage(i18n.language === "en" ? "es" : "en")}
        accessibilityRole="button"
        accessibilityLabel={t("common.language")}
        className="absolute top-12 right-6 bg-surface rounded-full px-3 py-1.5 border border-border z-10"
      >
        <Text className="text-sm font-semibold text-content-secondary">
          {i18n.language === "en" ? "ES" : "EN"}
        </Text>
      </Pressable>

      {/* App icon + brush wordmark (Edo SZ), sized to dominate the screen */}
      <View className="items-center mb-12">
        <Image
          source={require("@/assets/images/app-icon/icon.png")}
          style={{
            width: 112,
            height: 112,
            borderRadius: 24,
            borderWidth: 1,
            borderColor: colors.border,
          }}
          accessibilityIgnoresInvertColors
        />
        <Text
          className="font-display text-content-primary text-6xl text-center mt-5"
          style={{ lineHeight: 64 }}
        >
          The Hokage
        </Text>
        <Text className="text-brand-accent text-sm font-bold uppercase tracking-[4px] mt-1">
          Coaching App
        </Text>
        {/* <Text className="text-content-tertiary mt-3 text-base">
          {t("auth.fitnessCompanion")}
        </Text> */}
      </View>

      <View className="gap-4">
        {!online && (
          <View className="bg-warning-soft rounded-xl p-3">
            <Text className="text-warning text-sm text-center">
              {t("auth.offlineLogin")}
            </Text>
          </View>
        )}

        <Input
          placeholder={t("auth.emailPlaceholder")}
          leftIcon="mail-outline"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            if (emailError != null) setEmailError(undefined);
            if (formError != null) setFormError(null);
          }}
          error={emailError}
          size="lg"
        />

        <Input
          placeholder={t("auth.enterPassword")}
          leftIcon="key-outline"
          secureTextEntry
          value={password}
          onChangeText={(text) => {
            setPassword(text);
            if (passwordError != null) setPasswordError(undefined);
            if (formError != null) setFormError(null);
          }}
          error={passwordError}
          size="lg"
        />

        {formError != null && (
          <View className="bg-error-soft rounded-xl p-3">
            <Text className="text-error text-sm">{formError}</Text>
          </View>
        )}

        <Button size="lg" onPress={handleLogin} loading={loading} className="mt-2 rounded-2xl">
          {t("auth.signIn")}
        </Button>

        {/* No self-signup: the coach creates every account from the admin
            panel. The "or / Registrarse" pair and the /register screen were
            removed with it. A "contact your coach" flow is planned to take
            this space. */}
      </View>
    </Screen>
  );
}
