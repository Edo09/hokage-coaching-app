import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";

import { useAuth } from "@/src/hooks/use-auth";
import { usePermissionStatus } from "@/src/lib/notification-permission";
import { ensurePushChannel, registerPushToken, unregisterPushToken } from "@/src/lib/push";

/**
 * Keeps this phone in `push_tokens` for the signed-in client, so the coach's
 * pushes (`@/src/lib/push`) reach it. Mounted with the reminders, in the tabs
 * layout: only a signed-in, onboarded client gets here.
 *
 * Registers once notifications are allowed (onboarding's last step, Ajustes,
 * or the phone's settings), again when the OS hands out a new token, and
 * takes the token out when they are turned off. Sign-out takes it out too
 * (`useAuth().signOut`). Also creates the push channel, renamed with the
 * language like the reminders'. Nothing on web.
 */
export function usePushToken(): void {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { user } = useAuth();
  const userId = user?.id;
  const { status } = usePermissionStatus();

  useEffect(() => {
    if (Platform.OS === "web") return;
    void ensurePushChannel(t("push.channelName"));
  }, [t, language]);

  useEffect(() => {
    if (Platform.OS === "web" || userId == null || status == null) return;
    if (status !== "granted") {
      void unregisterPushToken();
      return;
    }
    void registerPushToken(userId);
    const sub = Notifications.addPushTokenListener(() => {
      void registerPushToken(userId);
    });
    return () => sub.remove();
  }, [userId, status]);
}
