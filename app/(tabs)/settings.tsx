import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking } from "react-native";

import { CoachSection } from "@/src/components/coach-section";
import { Button, Card, Input, Screen, useToast } from "@/src/components/ui";
import { setLanguage } from "@/src/i18n";
import { useIsOnline } from "@/src/lib/online";
import { setWeightUnit, useWeightUnit } from "@/src/lib/weight-unit";
import { useColors } from "@/src/theme/colors";
import { setThemeMode } from "@/src/theme/theme-mode";
import { useThemeScheme } from "@/src/theme/theme-store";
import { Pressable, Text, View } from "@/src/tw";
import { supabase } from "@/src/utils/supabase";

type RowProps = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  onPress: () => void;
  last?: boolean;
};

// Tappable preference row: label left, current value + chevron right.
// Tapping cycles the setting (all three prefs are binary toggles today).
function SettingsRow({ icon, label, value, onPress, last = false }: RowProps) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      className={`flex-row items-center gap-3 py-3.5 ${last ? "" : "border-b border-border"}`}
    >
      <View className="h-8 w-8 items-center justify-center rounded-lg bg-brand-dark">
        <Ionicons name={icon} size={16} color={colors.contentSecondary} />
      </View>
      <Text className="flex-1 text-[15px] font-medium text-content-primary">{label}</Text>
      <Text className="text-sm text-content-tertiary">{value}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.contentMuted} />
    </Pressable>
  );
}

// Lets a client rotate the temporary password the coach created their
// account with (panel "Añadir cliente" flow) — or change it any time.
function ChangePasswordCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const online = useIsOnline();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (password.length < 8) {
      setError(t("auth.passwordLength"));
      return;
    }
    if (password !== confirm) {
      setError(t("settings.passwordsDontMatch"));
      return;
    }
    if (!online) {
      toast.show({ type: "info", message: t("common.requiresInternet") });
      return;
    }
    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      toast.show({ type: "success", message: t("settings.passwordChanged") });
      setPassword("");
      setConfirm("");
      setOpen(false);
    } catch {
      toast.show({ type: "error", message: t("common.somethingWentWrong") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="py-0">
      <SettingsRow
        icon="key-outline"
        label={t("settings.changePassword")}
        value=""
        onPress={() => setOpen((v) => !v)}
        last={!open}
      />
      {open && (
        <View className="gap-3 py-4">
          <Input
            label={t("settings.newPassword")}
            placeholder={t("auth.passwordPlaceholder")}
            helper={error == null ? t("auth.passwordMin") : undefined}
            error={error}
            secureTextEntry
            autoCapitalize="none"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (error != null) setError(undefined);
            }}
            className="bg-brand-dark"
          />
          <Input
            label={t("settings.confirmPassword")}
            placeholder={t("auth.passwordPlaceholder")}
            secureTextEntry
            autoCapitalize="none"
            value={confirm}
            onChangeText={(text) => {
              setConfirm(text);
              if (error != null) setError(undefined);
            }}
            className="bg-brand-dark"
          />
          <Button onPress={submit} loading={saving} className="w-full">
            {t("settings.changePassword")}
          </Button>
        </View>
      )}
    </Card>
  );
}

// Public privacy-policy page (the panel serves it at /privacidad.html). Set
// per deployment in EAS, since the URL is the coach's domain; the row is
// hidden until it is set.
const PRIVACY_POLICY_URL = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL;

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const scheme = useThemeScheme();
  const isDark = scheme === "dark";
  const weightUnit = useWeightUnit();

  return (
    <Screen contentContainerClassName="gap-4">
      <Card className="py-0">
        <SettingsRow
          icon={isDark ? "moon-outline" : "sunny-outline"}
          label={t("settings.theme")}
          value={t(isDark ? "home.dark" : "home.light")}
          onPress={() => void setThemeMode(isDark ? "light" : "dark")}
        />
        <SettingsRow
          icon="language-outline"
          label={t("settings.language")}
          value={i18n.language === "es" ? t("common.spanish") : t("common.english")}
          onPress={() => setLanguage(i18n.language === "en" ? "es" : "en")}
        />
        <SettingsRow
          icon="scale-outline"
          label={t("settings.weightUnit")}
          value={t(weightUnit === "kg" ? "settings.unitKgLabel" : "settings.unitLbLabel")}
          onPress={() => void setWeightUnit(weightUnit === "kg" ? "lb" : "kg")}
          last
        />
      </Card>

      <ChangePasswordCard />

      {PRIVACY_POLICY_URL ? (
        <Card className="py-0">
          <SettingsRow
            icon="shield-checkmark-outline"
            label={t("settings.privacyPolicy")}
            value=""
            onPress={() => void Linking.openURL(PRIVACY_POLICY_URL).catch(() => {})}
            last
          />
        </Card>
      ) : null}

      {/* Coach + membership (moved from Profile — read-only, coach manages on web) */}
      <CoachSection />
    </Screen>
  );
}
