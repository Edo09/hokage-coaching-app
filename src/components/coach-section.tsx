import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React from "react";
import { useTranslation } from "react-i18next";
import { Linking } from "react-native";

import { MembershipCard } from "@/src/components/membership-card";
import { SubscriptionCard } from "@/src/components/premium/subscription-card";
import { Button, Card } from "@/src/components/ui";
import { useCoach } from "@/src/hooks/use-coach";
import { useMembership } from "@/src/hooks/use-membership";
import { useColors } from "@/src/theme/colors";
import { Text, View } from "@/src/tw";

// Client-side coaching surface: who your coach is, a WhatsApp shortcut, and
// your membership status. All read-only — the coach manages everything on web.
export function CoachSection() {
  const { t } = useTranslation();
  const colors = useColors();
  const { coach } = useCoach();
  const { membership } = useMembership();

  const hasWhatsapp = coach?.whatsapp != null && coach.whatsapp !== "";

  const openWhatsapp = () => {
    if (!hasWhatsapp) return;
    const digits = coach!.whatsapp!.replace(/[^0-9]/g, "");
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(t("coach.whatsappPrefill"))}`;
    Linking.openURL(url).catch(() => {});
  };

  return (
    <>
      <Card className="gap-3">
        <Text className="text-[15px] font-bold text-content-primary">
          {t("coach.yourCoach")}
        </Text>

        <View className="flex-row items-center gap-3">
          {coach?.avatar_url != null && coach.avatar_url !== "" ? (
            <Image
              source={{ uri: coach.avatar_url }}
              style={{ width: 44, height: 44, borderRadius: 22 }}
              contentFit="cover"
              transition={200}
            />
          ) : (
            <View className="h-11 w-11 items-center justify-center rounded-full bg-info-soft">
              <Ionicons name="person" size={22} color={colors.brandPrimary} />
            </View>
          )}
          <Text className="flex-1 text-base font-semibold text-content-primary">
            {coach?.display_name ?? t("coach.noCoachYet")}
          </Text>
        </View>

        {hasWhatsapp && (
          <Button variant="secondary" icon="logo-whatsapp" onPress={openWhatsapp}>
            {t("coach.contactWhatsapp")}
          </Button>
        )}
      </Card>

      <MembershipCard membership={membership} />

      {/* Premium: the store subscription, beside the coach-set membership */}
      <SubscriptionCard />
    </>
  );
}
