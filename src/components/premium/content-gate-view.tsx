import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/src/components/empty-state";
import { Card, SkewButton } from "@/src/components/ui";
import { requestSheet } from "@/src/lib/request-sheet";
import { useColors } from "@/src/theme/colors";
import { Text } from "@/src/tw";
import { formatShortDate, toDateKey } from "@/src/utils/dates";
import { gateCopy, requestKindOf, type GateKind, type ShownGate } from "@/src/utils/subscription";

type Props = {
  kind: GateKind;
  shown: ShownGate;
  /** `screen`: a tab's empty state. `card`: Home's program card. */
  variant: "screen" | "card";
};

/**
 * A tab or Home card in place of the coach's content: «Aún sin programa» with
 * the button that asks (the request sheet) or subscribes (the paywall),
 * «Solicitud enviada» with its date, or «Tu acceso terminó» with the renewal.
 * What each says and does is src/utils/subscription.ts's gateCopy.
 */
export function ContentGateView({ kind, shown, variant }: Props) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const copy = gateCopy(kind, shown);

  const onAction =
    copy.action === "request"
      ? () => {
          const requestKind = requestKindOf(kind);
          if (requestKind != null) requestSheet.open(requestKind);
        }
      : copy.action === "paywall"
        ? () => router.push("/paywall")
        : undefined;

  const footnote =
    copy.footnoteKey != null && shown.kind === "pending"
      ? t(copy.footnoteKey, {
          date: formatShortDate(toDateKey(new Date(shown.since)), i18n.language),
        })
      : undefined;
  const actionLabel = copy.actionKey != null ? t(copy.actionKey) : undefined;

  if (variant === "screen") {
    return (
      <EmptyState
        icon={copy.icon}
        title={t(copy.titleKey)}
        subtitle={t(copy.hintKey)}
        footnote={footnote}
        actionLabel={actionLabel}
        onAction={onAction}
      />
    );
  }

  return (
    <Card
      // With a button of its own the card is not a button too (nested buttons);
      // without one, a tap opens the tab that says the same.
      onPress={onAction == null ? () => router.push("/(tabs)/routines") : undefined}
      className="items-center gap-2 rounded-[20px] p-6"
    >
      <Ionicons name={copy.icon} size={26} color={colors.contentTertiary} />
      {/* Nothing to offer: Home's card as it was before Premium, the hint alone. */}
      {!copy.plain && (
        <Text className="text-center text-[15px] font-bold text-content-primary">{t(copy.titleKey)}</Text>
      )}
      <Text className="text-center text-[13px] text-content-secondary">{t(copy.hintKey)}</Text>
      {footnote != null && <Text className="text-center text-[11px] text-content-muted">{footnote}</Text>}
      {actionLabel != null && onAction != null && (
        <SkewButton size="compact" onPress={onAction} className="mt-1">
          {actionLabel}
        </SkewButton>
      )}
    </Card>
  );
}
