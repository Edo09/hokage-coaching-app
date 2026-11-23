import { router } from "expo-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { BottomSheet, Button, CapsLabel, PosterText, SkewButton, useToast } from "@/src/components/ui";
import { useRequestContent } from "@/src/hooks/use-request-content";
import { useIsOnline } from "@/src/lib/online";
import { requestSheet, useRequestSheet } from "@/src/lib/request-sheet";
import { useColors } from "@/src/theme/colors";
import { ScrollView, Text, TextInput, View } from "@/src/tw";
import type { ContentRequestKind } from "@/src/types/database";
import { REQUEST_NOTE_MAX, type RequestError } from "@/src/utils/content-request";

type FormProps = {
  kind: ContentRequestKind;
  note: string;
  onNoteChange: (text: string) => void;
  /** What the server or the phone said back; null before and after a retry. */
  error: RequestError | null;
  sending: boolean;
  online: boolean;
  onSend: () => void;
  onViewPlans: () => void;
};

/**
 * The sheet's content: one tap and an optional note (the onboarding profile is
 * the intake). Presentational, so the states can be looked at without a
 * server: RequestBody below feeds it.
 */
export function RequestForm({
  kind,
  note,
  onNoteChange,
  error,
  sending,
  online,
  onSend,
  onViewPlans,
}: FormProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const ns = kind === "program" ? "program" : "nutrition";
  // premium_required has its own panel and already_assigned closes the sheet.
  const failure =
    error == null || error === "premium_required" || error === "already_assigned"
      ? null
      : error === "offline"
        ? t("premium.states.offline")
        : t("premium.request.failed");

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      bounces={false}
      contentContainerClassName="gap-4 px-5 pb-2 pt-4"
    >
      <View className="gap-1.5">
        <PosterText size={22}>{t(`premium.gate.${ns}.requestAction`)}</PosterText>
        <Text className="text-[13px] text-content-secondary">{t("premium.request.hint")}</Text>
      </View>

      <View className="gap-1.5">
        <CapsLabel size={9} em={0.14}>
          {t("premium.request.noteLabel")}
        </CapsLabel>
        <TextInput
          value={note}
          onChangeText={onNoteChange}
          placeholder={t("premium.request.notePlaceholder")}
          placeholderTextColor={colors.contentMuted}
          multiline
          maxLength={REQUEST_NOTE_MAX}
          textAlignVertical="top"
          editable={!sending}
          accessibilityLabel={t("premium.request.noteLabel")}
          className="min-h-[96px] rounded-[14px] border border-border bg-brand-dark px-3 py-2.5 text-[13px] text-content-primary"
        />
        <Text
          className="self-end text-[11px] text-content-muted"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {note.length}/{REQUEST_NOTE_MAX}
        </Text>
      </View>

      {error === "premium_required" && (
        <View className="gap-2.5 rounded-2xl border border-border bg-brand-dark p-3.5">
          <Text className="text-[13px] font-semibold text-content-primary">
            {t("premium.request.needsPlan")}
          </Text>
          <Button variant="secondary" size="sm" onPress={onViewPlans}>
            {t("premium.request.viewPlans")}
          </Button>
        </View>
      )}

      {failure != null && <Text className="text-[13px] font-semibold text-error">{failure}</Text>}

      <View className="gap-1.5">
        <SkewButton onPress={onSend} loading={sending} disabled={!online || sending}>
          {t("premium.request.send")}
        </SkewButton>
        {!online && (
          <Text className="text-center text-[12px] text-content-tertiary">
            {t("common.requiresInternet")}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

function RequestBody({ kind }: { kind: ContentRequestKind }) {
  const { t } = useTranslation();
  const toast = useToast();
  const online = useIsOnline();
  const { send, sending } = useRequestContent();
  const [note, setNote] = useState("");
  const [error, setError] = useState<RequestError | null>(null);

  const submit = async () => {
    setError(null);
    const result = await send(kind, note);
    if (result.ok) {
      requestSheet.close();
      toast.show({ type: "success", message: t("premium.gate.pendingTitle") });
    } else if (result.error === "already_assigned") {
      // The coach got there first: the screens read it again (useRequestContent).
      requestSheet.close();
      toast.show({ type: "info", message: t("premium.request.alreadyAssigned") });
    } else {
      setError(result.error);
    }
  };

  return (
    <RequestForm
      kind={kind}
      note={note}
      onNoteChange={(text) => {
        setNote(text);
        if (error != null) setError(null);
      }}
      error={error}
      sending={sending}
      online={online}
      onSend={() => void submit()}
      // The paywall is a native modal screen: on iOS it is not presented while
      // this sheet's own Modal is still dismissing, so it waits for it.
      onViewPlans={() => requestSheet.closeThen(() => router.push("/paywall"))}
    />
  );
}

/**
 * The one request sheet, hosted by the tabs layout and opened from anywhere
 * with requestSheet.open(kind). The last kind stays rendered while the sheet
 * slides out, and each opening starts with an empty note and no error.
 */
export function RequestSheetHost() {
  const kind = useRequestSheet();
  const [shown, setShown] = useState<ContentRequestKind | null>(kind);
  const [opens, setOpens] = useState(kind != null ? 1 : 0);
  const [wasOpen, setWasOpen] = useState(kind != null);
  if (kind != null && kind !== shown) setShown(kind);
  if ((kind != null) !== wasOpen) {
    setWasOpen(kind != null);
    if (kind != null) setOpens((n) => n + 1);
  }

  return (
    <BottomSheet visible={kind != null} onClose={requestSheet.close} onDismiss={requestSheet.dismissed}>
      {shown != null && <RequestBody key={opens} kind={shown} />}
    </BottomSheet>
  );
}
