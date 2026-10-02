import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking } from "react-native";

import { openExactAlarmSettings, useCanScheduleExactAlarms } from "@/modules/exact-alarms";
import { CoachSection } from "@/src/components/coach-section";
import { NotificationsCard } from "@/src/components/notifications-card";
import { SettingsRow } from "@/src/components/settings-row";
import { Button, Card, Input, Screen, useToast } from "@/src/components/ui";
import { setLanguage } from "@/src/i18n";
import { ALERT_MODES, setAlertMode, useAlertMode } from "@/src/lib/alert-mode";
import { Reveal } from "@/src/lib/motion";
import { useIsOnline } from "@/src/lib/online";
import { playRestDoneAlert } from "@/src/lib/rest-alert";
import { setWeightUnit, useWeightUnit } from "@/src/lib/weight-unit";
import { useColors } from "@/src/theme/colors";
import { setThemeMode } from "@/src/theme/theme-mode";
import { useThemeScheme } from "@/src/theme/theme-store";
import { Pressable, Text, View } from "@/src/tw";
import { supabase } from "@/src/utils/supabase";

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
      <Reveal open={open} className="gap-3 py-4">
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
      </Reveal>
    </Card>
  );
}

// How the rest timer gets the client's attention when a rest starts and ends:
// sound and vibration, vibration only, or sound only. Picking an option plays
// the end-of-rest alert in that mode, so they feel/hear what they chose.
function RestAlertCard() {
  const { t } = useTranslation();
  const colors = useColors();
  const mode = useAlertMode();
  const exactAlarms = useCanScheduleExactAlarms();
  const [open, setOpen] = useState(false);

  return (
    <Card className="py-0">
      <SettingsRow
        icon="timer-outline"
        label={t("settings.restAlert")}
        value={t(`settings.restAlert_${mode}`)}
        onPress={() => setOpen((v) => !v)}
        last={!open}
      />
      <Reveal open={open}>
        <View accessibilityRole="radiogroup" className="gap-0.5 pb-3.5 pt-1.5">
          {ALERT_MODES.map((m) => {
            const selected = m === mode;
            return (
              <Pressable
                key={m}
                onPress={() => {
                  void setAlertMode(m);
                  playRestDoneAlert(m);
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={t(`settings.restAlert_${m}`)}
                className="flex-row items-center gap-3 py-2.5"
              >
                <Ionicons
                  name={selected ? "radio-button-on" : "radio-button-off"}
                  size={20}
                  color={selected ? colors.brandPrimary : colors.contentMuted}
                />
                <Text className="flex-1 text-[15px] text-content-primary">{t(`settings.restAlert_${m}`)}</Text>
              </Pressable>
            );
          })}
          <Text className="pt-1.5 text-[12px] leading-[17px] text-content-tertiary">
            {t("settings.restAlertHint")}
          </Text>
        </View>
      </Reveal>
      {exactAlarms ? null : (
        // Android without exact-alarm access: the rest-done notification falls
        // back to an inexact alarm that can land late. Outside the Reveal so it
        // is seen without opening the card; gone once granted.
        <Pressable
          onPress={() => {
            if (!openExactAlarmSettings()) void Linking.openSettings().catch(() => {});
          }}
          accessibilityRole="button"
          accessibilityLabel={`${t("settings.exactAlarmsHint")} ${t("settings.exactAlarmsAction")}`}
          className="flex-row items-center gap-3 border-t border-border py-3.5"
        >
          <View className="h-8 w-8 items-center justify-center rounded-lg bg-brand-dark">
            <Ionicons name="alarm-outline" size={16} color={colors.warning} />
          </View>
          <Text className="flex-1 text-[13px] text-content-secondary">{t("settings.exactAlarmsHint")}</Text>
          <Text className="text-sm font-semibold text-brand-primary">{t("settings.exactAlarmsAction")}</Text>
        </Pressable>
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

      <RestAlertCard />

      <NotificationsCard />

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
