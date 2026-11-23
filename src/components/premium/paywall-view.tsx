import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { Linking } from "react-native";

import { PlanCard } from "@/src/components/premium/plan-card";
import { Button, Card, HeaderPanel, PosterText, SkewButton, Spinner } from "@/src/components/ui";
import type { PlanKind } from "@/src/config/purchases";
import { useColors } from "@/src/theme/colors";
import { Pressable, ScrollView, Text, View } from "@/src/tw";
import type { Plan } from "@/src/utils/purchase";
import type { FlowState } from "@/src/utils/purchase-flow";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

export type PaywallViewProps = {
  /** The store can sell here (native with a key). When false the screen only explains. */
  available: boolean;
  os: "ios" | "android" | "web";
  plans: Plan[];
  plansStatus: "loading" | "ready" | "error";
  onReloadPlans: () => void;
  selected: PlanKind | null;
  onSelect: (kind: PlanKind) => void;
  flow: FlowState;
  online: boolean;
  /** A store subscription already grants access. */
  subscribed: boolean;
  /** The success panel's date line: when it renews, or when access ends. */
  date: { kind: "renews" | "ends"; iso: string } | null;
  onBuy: () => void;
  onRestore: () => void;
  onManage: () => void;
  onClose: () => void;
  termsUrl: string | null;
  privacyUrl: string | null;
};

/**
 * The paywall (docs/superpowers/specs/2026-11-16-premium-subscriptions-
 * design.md, «Paywall»), built from the app's own components, not the SDK's.
 * Presentational: app/paywall.tsx feeds it. Shows, by state: the offer (what
 * the client gets, three plans with the store's prices, «Suscribirme»,
 * restore, manage, the renewal terms and the Terms and Privacy links), the
 * wait for the server («Confirmando tu compra…», then «Tu compra se está
 * procesando»), success, or just an explanation where buying is impossible.
 */
export function PaywallView(props: PaywallViewProps) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const { available, flow, subscribed } = props;

  const mode = !available
    ? "unavailable"
    : flow.phase === "confirmed"
      ? "success"
      : flow.phase === "idle" && subscribed
        ? "already"
        : flow.phase === "confirming"
          ? "confirming"
          : flow.phase === "processing"
            ? "processing"
            : "offer";

  return (
    <View className="flex-1 bg-brand-dark">
      <HeaderPanel className="border-b border-border">
        <View className="flex-row items-center gap-3">
          <View accessibilityRole="header" className="flex-1">
            <PosterText size={26} numberOfLines={1} adjustsFontSizeToFit>
              {t("premium.paywall.title")}
            </PosterText>
          </View>
          <Pressable
            onPress={props.onClose}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            hitSlop={10}
            className="h-9 w-9 items-center justify-center rounded-full border border-border bg-surface"
          >
            <Ionicons name="close" size={20} color={colors.contentPrimary} />
          </Pressable>
        </View>
      </HeaderPanel>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pb-10 pt-5"
        keyboardShouldPersistTaps="handled"
      >
        {mode === "unavailable" && (
          <Panel
            icon="phone-portrait-outline"
            title={t(props.os === "web" ? "premium.paywall.webTitle" : "premium.paywall.title")}
            hint={t(props.os === "web" ? "premium.paywall.webHint" : "premium.paywall.unavailableHint")}
          >
            <Button variant="secondary" onPress={props.onClose}>
              {t("common.close")}
            </Button>
          </Panel>
        )}

        {(mode === "success" || mode === "already") && (
          <Panel
            icon="checkmark-circle"
            tone="success"
            title={t(mode === "success" ? "premium.paywall.successTitle" : "premium.paywall.alreadyTitle")}
            hint={t(
              flow.restored === "found" ? "premium.states.restored" : "premium.paywall.successHint",
            )}
            footnote={
              props.date != null
                ? t(props.date.kind === "renews" ? "premium.paywall.renewsOn" : "premium.paywall.endsOn", {
                    date: formatLongDate(props.date.iso, i18n.language),
                  })
                : undefined
            }
          >
            <SkewButton onPress={props.onClose}>{t("premium.paywall.done")}</SkewButton>
            <Button variant="ghost" size="sm" onPress={props.onManage}>
              {t("premium.card.manage")}
            </Button>
          </Panel>
        )}

        {mode === "confirming" && (
          <Card className="items-center gap-3 py-8">
            <Spinner size="large" />
            <Text className="text-center text-[15px] font-bold text-content-primary">
              {t("premium.states.confirming")}
            </Text>
          </Card>
        )}

        {mode === "processing" && (
          <Panel
            icon="time-outline"
            title={t("premium.states.processing")}
            hint={t("premium.paywall.processingHint")}
          >
            <Button variant="secondary" onPress={props.onClose}>
              {t("common.close")}
            </Button>
          </Panel>
        )}

        {mode === "offer" && <Offer {...props} />}
      </ScrollView>
    </View>
  );
}

/** A centered message card: an icon, a title, a hint, a date and its buttons. */
function Panel({
  icon,
  tone,
  title,
  hint,
  footnote,
  children,
}: {
  icon: IoniconName;
  tone?: "success";
  title: string;
  hint: string;
  footnote?: string;
  children?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <Card className="items-center gap-3 py-7">
      <Ionicons
        name={icon}
        size={40}
        color={tone === "success" ? colors.success : colors.contentTertiary}
      />
      <Text className="text-center text-lg font-bold text-content-primary">{title}</Text>
      <Text className="text-center text-sm text-content-secondary">{hint}</Text>
      {footnote != null && <Text className="text-center text-xs text-content-muted">{footnote}</Text>}
      {children != null && <View className="mt-2 w-full gap-2">{children}</View>}
    </Card>
  );
}

/** A date as «23 de noviembre de 2026» in the app's language. */
function formatLongDate(iso: string, language: string): string {
  return new Date(iso).toLocaleDateString(language === "es" ? "es-ES" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function Offer({
  os,
  plans,
  plansStatus,
  onReloadPlans,
  selected,
  onSelect,
  flow,
  online,
  onBuy,
  onRestore,
  onManage,
  termsUrl,
  privacyUrl,
}: PaywallViewProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const busy = flow.phase === "purchasing" || flow.phase === "restoring";
  const canBuy = plansStatus === "ready" && selected != null && online && !busy;
  const failure = flow.failure;

  const failureText =
    failure == null
      ? null
      : failure.kind === "pending"
        ? t("premium.states.pendingApproval")
        : failure.kind === "offline"
          ? t("premium.states.offline")
          : failure.kind === "already_purchased"
            ? t("premium.paywall.alreadyPurchased")
            : t("premium.states.failed");

  const benefits = [
    "premium.paywall.benefitProgram",
    "premium.paywall.benefitNutrition",
    "premium.paywall.benefitAccess",
  ] as const;

  return (
    <>
      <View className="gap-2.5">
        {benefits.map((key) => (
          <View key={key} className="flex-row items-start gap-2.5">
            <Ionicons name="checkmark-circle" size={18} color={colors.brandPrimary} />
            <Text className="flex-1 text-[14px] text-content-secondary">{t(key)}</Text>
          </View>
        ))}
      </View>

      {plansStatus === "loading" && (
        <View className="items-center gap-3 py-8">
          <Spinner size="large" />
          <Text className="text-sm text-content-tertiary">{t("premium.paywall.loadingPlans")}</Text>
        </View>
      )}

      {plansStatus === "error" && (
        <Card className="items-center gap-3">
          <Text className="text-center text-sm text-content-secondary">
            {t("premium.paywall.plansFailed")}
          </Text>
          <Button variant="secondary" size="sm" onPress={onReloadPlans}>
            {t("common.retry")}
          </Button>
        </Card>
      )}

      {plansStatus === "ready" && (
        <View accessibilityRole="radiogroup" className="gap-3">
          {plans.map((plan) => (
            <PlanCard
              key={plan.kind}
              plan={plan}
              selected={plan.kind === selected}
              disabled={busy}
              onSelect={() => onSelect(plan.kind)}
            />
          ))}
        </View>
      )}

      <View className="gap-2">
        <SkewButton onPress={onBuy} loading={flow.phase === "purchasing"} disabled={!canBuy}>
          {t("premium.paywall.subscribe")}
        </SkewButton>
        {!online && (
          <Text className="text-center text-[12px] font-semibold text-warning">
            {t("premium.states.offline")}
          </Text>
        )}
        {failureText != null && (
          <View className="gap-1">
            <Text className="text-center text-[13px] font-semibold text-error">{failureText}</Text>
            {failure?.kind === "store_problem" && failure.detail != null && (
              <Text className="text-center text-[12px] text-content-tertiary">{failure.detail}</Text>
            )}
          </View>
        )}
      </View>

      <View className="gap-1">
        <Button
          variant={failure?.kind === "already_purchased" ? "primary" : "secondary"}
          size="sm"
          loading={flow.phase === "restoring"}
          disabled={busy || !online}
          onPress={onRestore}
        >
          {t("premium.paywall.restore")}
        </Button>
        {flow.restored === "none" && (
          <Text className="text-center text-[12px] text-content-tertiary">
            {t("premium.states.nothingToRestore")}
          </Text>
        )}
        <Button variant="ghost" size="sm" onPress={onManage}>
          {t("premium.card.manage")}
        </Button>
      </View>

      <View className="gap-2">
        <Text className="text-[12px] font-semibold text-content-secondary">
          {t("premium.paywall.renewsAutomatically")}
        </Text>
        {os !== "web" && (
          <Text className="text-[11px] text-content-tertiary">
            {t(os === "ios" ? "premium.paywall.disclosureIos" : "premium.paywall.disclosureAndroid")}
          </Text>
        )}
        <View className="flex-row flex-wrap gap-x-4 gap-y-1">
          {termsUrl != null && (
            <Pressable
              onPress={() => void Linking.openURL(termsUrl).catch(() => {})}
              accessibilityRole="link"
              hitSlop={6}
            >
              <Text className="text-[12px] font-semibold text-brand-primary">
                {t("premium.paywall.terms")}
              </Text>
            </Pressable>
          )}
          {privacyUrl != null && (
            <Pressable
              onPress={() => void Linking.openURL(privacyUrl).catch(() => {})}
              accessibilityRole="link"
              hitSlop={6}
            >
              <Text className="text-[12px] font-semibold text-brand-primary">
                {t("premium.paywall.privacy")}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </>
  );
}
