import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Input, Screen } from "@/src/components/ui";
import { useAuth } from "@/src/hooks/use-auth";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import { signUpErrorKey } from "@/src/utils/auth-errors";

export default function Register() {
  const { t } = useTranslation();
  const colors = useColors();
  const { signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    const errors = {
      name: name.trim() ? undefined : t("common.fieldRequired"),
      email: email.trim() ? undefined : t("common.fieldRequired"),
      password: !password
        ? t("common.fieldRequired")
        : password.length < 8
          ? t("auth.passwordLength")
          : undefined,
    };
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }

    try {
      setLoading(true);
      setFormError(null);
      const { needsEmailConfirmation } = await signUp(email.trim(), password, name.trim());
      if (needsEmailConfirmation) {
        setConfirmationSent(true);
        return;
      }
      router.replace("/(tabs)");
    } catch (error) {
      setFormError(t(signUpErrorKey(error)));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen keyboard contentContainerClassName="flex-1 justify-center px-6 py-12 gap-0">
      <View className="items-center mb-8">
        <Image
          source={require("@/assets/images/app-icon/icon.png")}
          style={{
            width: 88,
            height: 88,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: colors.border,
          }}
          accessibilityIgnoresInvertColors
        />
        <Text className="font-display text-content-primary text-5xl text-center mt-4">
          {t("auth.createAccount")}
        </Text>
      </View>

      {confirmationSent ? (
        <View className="gap-4">
          <View className="bg-success-soft rounded-xl p-4 gap-1">
            <Text className="text-success font-semibold">{t("auth.confirmEmailTitle")}</Text>
            <Text className="text-content-secondary text-sm">
              {t("auth.confirmEmailBody", { email: email.trim() })}
            </Text>
          </View>
          <Button
            size="lg"
            onPress={() => router.replace("/(auth)/login")}
            className="rounded-2xl"
          >
            {t("auth.signIn")}
          </Button>
        </View>
      ) : (
        <View className="gap-4">
          <Input
            placeholder={t("auth.namePlaceholder")}
            leftIcon="person-outline"
            autoCapitalize="words"
            value={name}
            onChangeText={(value) => {
              setName(value);
              setFieldErrors((current) => ({ ...current, name: undefined }));
              setFormError(null);
            }}
            error={fieldErrors.name}
            size="lg"
          />
          <Input
            placeholder={t("auth.emailPlaceholder")}
            leftIcon="mail-outline"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              setFieldErrors((current) => ({ ...current, email: undefined }));
              setFormError(null);
            }}
            error={fieldErrors.email}
            size="lg"
          />
          <Input
            placeholder={t("auth.enterPassword")}
            leftIcon="key-outline"
            secureTextEntry
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              setFieldErrors((current) => ({ ...current, password: undefined }));
              setFormError(null);
            }}
            error={fieldErrors.password}
            helper={t("auth.passwordLength")}
            size="lg"
          />
          {formError != null && (
            <View className="bg-error-soft rounded-xl p-3">
              <Text className="text-error text-sm">{formError}</Text>
            </View>
          )}
          <Button size="lg" onPress={handleRegister} loading={loading} className="mt-2 rounded-2xl">
            {t("auth.signUp")}
          </Button>
          <Pressable
            onPress={() => router.replace("/(auth)/login")}
            accessibilityRole="button"
            className="items-center py-3 active:opacity-70"
          >
            <Text className="text-content-secondary text-sm">
              {t("auth.haveAccount")}{" "}
              <Text
                className="text-brand-primary font-bold"
                style={{ textDecorationLine: "underline" }}
              >
                {t("auth.signIn")}
              </Text>
            </Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}
