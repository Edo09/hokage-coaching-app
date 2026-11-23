import { router } from "expo-router";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { Button, Card, SkewButton, useToast } from "@/src/components/ui";
import { usePremiumAccess } from "@/src/hooks/use-premium-access";
import { usePurchaseFlow } from "@/src/hooks/use-purchase-flow";
import { useAccessClock } from "@/src/lib/access-clock";
import { useIsOnline } from "@/src/lib/online";
import { purchases } from "@/src/lib/purchases";
import { Text, View } from "@/src/tw";
import { formatLongDate } from "@/src/utils/dates";
import type { PurchaseFailure } from "@/src/utils/purchase";
import { subscriptionCard, type SubscriptionCardView } from "@/src/utils/subscription";

// Soft badge per status, in the semantic tokens the membership card uses.
const STATUS_STYLE: Record<SubscriptionCardView["status"], { bg: string; text: string }> = {
  none: { bg: "bg-info-soft", text: "text-content-tertiary" },
  active: { bg: "bg-success-soft", text: "text-success" },
  cancelled: { bg: "bg-warning-soft", text: "text-warning" },
  billing_issue: { bg: "bg-warning-soft", text: "text-warning" },
  expired: { bg: "bg-error-soft", text: "text-error" },
  membership: { bg: "bg-success-soft", text: "text-success" },
};

type BodyProps = {
  view: SubscriptionCardView;
  online: boolean;
  /** A restore is running. */
  busy: boolean;
  onPlans: () => void;
  onManage: () => void;
  onRestore: () => void;
};

/**
 * Settings' subscription card, beside the membership card: the status, when it
 * renews or ends, and what can be done about it (see the plans, renew, manage
 * in the store, restore), or where to go when this device cannot sell. What it
 * shows and offers is src/utils/subscription.ts's subscriptionCard; this only
 * draws it.
 */
export function SubscriptionCardBody({ view, online, busy, onPlans, onManage, onRestore }: BodyProps) {
  const { t, i18n } = useTranslation();
  if (!view.show) return null;
  const style = STATUS_STYLE[view.status];

  return (
    <Card className="gap-2.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-content-primary">{t("premium.card.title")}</Text>
        <View className={`rounded-full px-2.5 py-1 ${style.bg}`}>
          <Text className={`text-xs font-semibold ${style.text}`}>
            {t(`premium.card.status_${view.status}`)}
          </Text>
        </View>
      </View>

      {view.date != null && (
        <Text className="text-sm text-content-tertiary">
          {t(`premium.card.date_${view.date.kind}`, {
            date: formatLongDate(view.date.iso, i18n.language),
          })}
        </Text>
      )}
      {view.status === "membership" && (
        <Text className="text-xs text-content-tertiary">{t("premium.card.membershipHint")}</Text>
      )}
      {view.status === "billing_issue" && (
        <Text className="text-xs text-warning">{t("premium.card.billingHint")}</Text>
      )}
      {view.sandbox && <Text className="text-xs text-warning">{t("premium.card.sandbox")}</Text>}
      {view.storeOnly && (
        <Text className="text-xs text-content-tertiary">{t("premium.card.storeOnly")}</Text>
      )}

      {view.action != null && (
        <SkewButton size="compact" onPress={onPlans}>
          {t(view.action === "plans" ? "premium.card.seePlans" : "premium.gate.renewAction")}
        </SkewButton>
      )}
      {view.manage && (
        <Button variant="secondary" size="sm" onPress={onManage}>
          {t("premium.card.manage")}
        </Button>
      )}
      {view.restore && (
        <Button variant="ghost" size="sm" loading={busy} disabled={!online} onPress={onRestore}>
          {t("premium.paywall.restore")}
        </Button>
      )}
    </Card>
  );
}

/** A toast's words for a restore that failed. */
function failureMessage(failure: PurchaseFailure, t: (key: string) => string): string {
  if (failure.kind === "pending") return t("premium.states.pendingApproval");
  if (failure.kind === "offline") return t("premium.states.offline");
  return t("premium.states.failed");
}

export function SubscriptionCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const online = useIsOnline();
  const { access, state } = usePremiumAccess();
  const now = useAccessClock();
  const { state: flow, restore, dismiss, reset } = usePurchaseFlow();

  const view = subscriptionCard({
    access,
    state,
    purchasable: purchases.available,
    dev: __DEV__,
    now,
  });

  // A restore's outcome as a toast, then the flow rests, so the next tap works.
  useEffect(() => {
    if (flow.failure != null) {
      toast.show({
        type: flow.failure.kind === "pending" ? "info" : "error",
        message: failureMessage(flow.failure, t),
      });
      dismiss();
    } else if (flow.restored === "none") {
      toast.show({ type: "info", message: t("premium.states.nothingToRestore") });
      dismiss();
    } else if (flow.phase === "confirmed") {
      toast.show({ type: "success", message: t("premium.states.restored") });
      reset();
    } else if (flow.phase === "processing") {
      toast.show({ type: "info", message: t("premium.states.processing") });
      reset();
    }
  }, [flow, toast, t, dismiss, reset]);

  const manage = async () => {
    if ((await purchases.manage()) === "unavailable") {
      toast.show({ type: "error", message: t("common.somethingWentWrong") });
    }
  };

  return (
    <SubscriptionCardBody
      view={view}
      online={online}
      busy={flow.phase === "restoring" || flow.phase === "confirming"}
      onPlans={() => router.push("/paywall")}
      onManage={() => void manage()}
      onRestore={() => void restore()}
    />
  );
}
