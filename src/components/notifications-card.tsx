import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Switch } from "react-native";

import { SettingsRow } from "@/src/components/settings-row";
import { Button, Card, Chip, ExpandChevron, useToast } from "@/src/components/ui";
import { useAuth } from "@/src/hooks/use-auth";
import { useProfile } from "@/src/hooks/use-profile";
import { useProgram } from "@/src/hooks/use-program";
import { PressableScale, Reveal } from "@/src/lib/motion";
import {
  openNotificationSettings,
  requestPermission,
  usePermissionStatus,
} from "@/src/lib/notification-permission";
import { qk } from "@/src/lib/query-keys";
import { setReminderPrefs, useReminderPrefs } from "@/src/lib/reminder-prefs";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import type { Profile } from "@/src/types/database";
import { cn } from "@/src/utils/cn";
import { DAY_LONG_KEYS } from "@/src/utils/progress";
import { REMINDER_HOURS } from "@/src/utils/reminder-prefs";
import { toggleTrainingDay, trainingDayIndexes } from "@/src/utils/training-days";

const formatHour = (hour: number) => `${hour}:00`;

// One reminder preference: label left, native switch right.
function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const colors = useColors();
  return (
    <View className="flex-row items-center gap-3 py-2">
      <Text className="flex-1 text-[15px] text-content-primary">{label}</Text>
      <Switch
        value={value}
        onValueChange={(next) => {
          Haptics.selectionAsync().catch(() => {});
          onChange(next);
        }}
        accessibilityLabel={label}
        trackColor={{ false: colors.borderStrong, true: colors.brandPrimary }}
        thumbColor={colors.white}
        ios_backgroundColor={colors.borderStrong}
      />
    </View>
  );
}

// One weekday of the training-days picker: its letter, filled when picked,
// styled like the kit's Chip. That Chip takes no accessibility label, and a
// letter alone is ambiguous (T, S in English), so screen readers get the
// full weekday.
function DayChip({
  letter,
  name,
  selected,
  onPress,
}: {
  letter: string;
  name: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      haptic
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={name}
      className={cn(
        "h-9 flex-1 items-center justify-center rounded-full",
        selected ? "bg-brand-primary" : "border border-border bg-surface",
      )}
    >
      <Text
        className={cn("text-sm font-semibold", selected ? "text-white" : "text-content-tertiary")}
      >
        {letter}
      </Text>
    </PressableScale>
  );
}

// Whether the phone lets the app notify, which local reminders to get (rules
// in `@/src/utils/reminders`), and on which days. The reminder choices are
// per device, like the rest-alert mode; the days are the client's profile.
// `useReminderSync` reschedules as soon as either changes.
function NotificationsCardContent() {
  const { t } = useTranslation();
  const colors = useColors();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { profile, updateProfile } = useProfile(user?.id);
  const { program } = useProgram();
  const prefs = useReminderPrefs();
  // Re-read when the app comes back to the foreground, so the row updates
  // after the client returns from the phone's settings, and after the prompt.
  const { status } = usePermissionStatus();
  const [open, setOpen] = useState(false);
  const [hourOpen, setHourOpen] = useState(false);

  // The client's training days, read the way the planner reads them.
  const pickedDays = trainingDayIndexes(profile?.available_days);
  const dayLetters = t("progress.dayLetters").split(",");

  // One tap switches one weekday in profiles.available_days, saved the way
  // onboarding saves it: into the cache at once, then through the outbox, so
  // it works offline too. Only that field: days_per_week stays as the client
  // or the coach set it.
  const toggleDay = (index: number) => {
    if (user == null) return;
    // The cache, not this render's profile: a second tap that lands before
    // the re-render builds on the first one.
    const current = queryClient.getQueryData<Profile | null>(qk.profile(user.id)) ?? profile;
    updateProfile({ available_days: toggleTrainingDay(current?.available_days, index) }).catch(
      () => {
        toast.show({ type: "error", message: t("common.somethingWentWrong") });
      },
    );
  };

  const statusLabel =
    status == null ? "" : t(status === "granted" ? "reminders.statusOn" : "reminders.statusOff");

  // Off: the way to turn them on sits right under the row, open or not.
  // requestPermission() makes every usePermissionStatus re-read, so the row and
  // useReminderSync both see the answer.
  const turnOn =
    status === "undetermined" ? (
      <Button
        variant="secondary"
        icon="notifications-outline"
        onPress={() => void requestPermission()}
        className="w-full"
      >
        {t("reminders.enableButton")}
      </Button>
    ) : status === "denied" ? (
      <Button
        variant="secondary"
        icon="settings-outline"
        onPress={() => void openNotificationSettings()}
        className="w-full"
      >
        {t("reminders.openSettings")}
      </Button>
    ) : null;

  return (
    <Card className="py-0">
      <SettingsRow
        icon="notifications-outline"
        label={t("reminders.cardTitle")}
        value={statusLabel}
        onPress={() => {
          setOpen((v) => !v);
          setHourOpen(false);
        }}
        last={!open || turnOn != null}
      />
      {turnOn != null && (
        <View className={`pb-3.5 ${open ? "border-b border-border" : ""}`}>{turnOn}</View>
      )}
      <Reveal open={open}>
        <View className="gap-0.5 pb-3.5 pt-1.5">
          <ToggleRow
            label={t("reminders.prefTraining")}
            value={prefs.training}
            onChange={(training) => void setReminderPrefs({ training })}
          />
          <ToggleRow
            label={t("reminders.prefInactivity")}
            value={prefs.inactivity}
            onChange={(inactivity) => void setReminderPrefs({ inactivity })}
          />
          {/* Only "Solo semana actual" programs have weeks that open later */}
          {program?.lock_future_weeks === true && (
            <ToggleRow
              label={t("reminders.prefWeek")}
              value={prefs.weekOpened}
              onChange={(weekOpened) => void setReminderPrefs({ weekOpened })}
            />
          )}

          <Pressable
            onPress={() => setHourOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: hourOpen }}
            accessibilityLabel={`${t("reminders.hour")}: ${formatHour(prefs.hour)}`}
            className="flex-row items-center gap-3 py-2.5"
          >
            <Text className="flex-1 text-[15px] text-content-primary">{t("reminders.hour")}</Text>
            <Text className="text-sm text-content-tertiary">{formatHour(prefs.hour)}</Text>
            <ExpandChevron open={hourOpen} size={16} color={colors.contentMuted} />
          </Pressable>
          <Reveal open={hourOpen} className="flex-row flex-wrap gap-2 pb-1.5">
            {REMINDER_HOURS.map((hour) => (
              <Chip
                key={hour}
                label={formatHour(hour)}
                selected={hour === prefs.hour}
                onPress={() => {
                  void setReminderPrefs({ hour });
                  setHourOpen(false);
                }}
              />
            ))}
          </Reveal>

          {/* Training days: only once the profile is in, so a tap never
              builds the list on a stand-in. Same field as onboarding, the
              panel and Progreso's planned days. */}
          {profile != null && (
            <View className="gap-2 pt-2.5">
              <Text className="text-[15px] text-content-primary">{t("reminders.daysLabel")}</Text>
              {pickedDays.size === 0 && (
                <Text className="text-[12px] leading-[17px] text-content-tertiary">
                  {t("reminders.noDaysHint")}
                </Text>
              )}
              <View className="flex-row gap-1.5">
                {DAY_LONG_KEYS.map((key, i) => (
                  <DayChip
                    key={key}
                    letter={dayLetters[i] ?? ""}
                    name={t(`daysLong.${key}`)}
                    selected={pickedDays.has(i)}
                    onPress={() => toggleDay(i)}
                  />
                ))}
              </View>
            </View>
          )}
        </View>
      </Reveal>
    </Card>
  );
}

// Ajustes → Notificaciones. Local reminders don't run on web, so the card is
// left out there.
export function NotificationsCard() {
  if (Platform.OS === "web") return null;
  return <NotificationsCardContent />;
}
