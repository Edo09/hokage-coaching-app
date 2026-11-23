import { router } from "expo-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";

import { PaywallView } from "@/src/components/premium/paywall-view";
import { useToast } from "@/src/components/ui";
import { PRIVACY_POLICY_URL, TERMS_URL_ENV, termsUrl, type PlanKind } from "@/src/config/purchases";
import { usePlans } from "@/src/hooks/use-plans";
import { usePremiumAccess } from "@/src/hooks/use-premium-access";
import { usePurchaseFlow } from "@/src/hooks/use-purchase-flow";
import { useAccessClock } from "@/src/lib/access-clock";
import { useIsOnline } from "@/src/lib/online";
import { purchases } from "@/src/lib/purchases";
import { defaultPlanKind } from "@/src/utils/purchase";
import { subscriptionCard } from "@/src/utils/subscription";

const OS = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";

// Premium's paywall, a route over the tabs (AuthGate leaves it alone for a
// signed-in client). Joins what the store offers (usePlans), what buying does
// (usePurchaseFlow) and what the server says the client has (usePremiumAccess)
// to the presentational PaywallView. Where the store cannot sell (web, or no
// SDK key) it only explains.
export default function PaywallScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const online = useIsOnline();
  const { plans, status, reload } = usePlans();
  const { state: flow, buy, restore } = usePurchaseFlow();
  const { access, state, subscribed } = usePremiumAccess();
  const now = useAccessClock();
  const [picked, setPicked] = useState<PlanKind | null>(null);

  const selected =
    picked != null && plans.some((p) => p.kind === picked) ? picked : defaultPlanKind(plans);

  // The success panel's date line is the Settings card's.
  const card = subscriptionCard({ access, state, purchasable: purchases.available, dev: false, now });
  const date = card.date != null && card.date.kind !== "ended" ? { kind: card.date.kind, iso: card.date.iso } : null;

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };

  const manage = async () => {
    if ((await purchases.manage()) === "unavailable") {
      toast.show({ type: "error", message: t("common.somethingWentWrong") });
    }
  };

  return (
    <PaywallView
      available={purchases.available}
      os={OS}
      plans={plans}
      plansStatus={status}
      onReloadPlans={reload}
      selected={selected}
      onSelect={setPicked}
      flow={flow}
      online={online}
      subscribed={subscribed}
      date={date}
      onBuy={() => {
        if (selected != null) void buy(selected);
      }}
      onRestore={() => void restore()}
      onManage={() => void manage()}
      onClose={close}
      termsUrl={termsUrl(OS, TERMS_URL_ENV)}
      privacyUrl={PRIVACY_POLICY_URL}
    />
  );
}
