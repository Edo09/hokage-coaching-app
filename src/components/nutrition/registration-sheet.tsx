import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Modal, Platform, type ScrollView as RNScrollView, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CapsLabel, PosterText, SkewButton } from "@/src/components/ui";
import { useKeyboardHeight } from "@/src/hooks/use-keyboard-height";
import { useMealPhotoPicker } from "@/src/hooks/use-meal-photo-picker";
import type { PhotoChange, PickedPhoto, RegisterInput } from "@/src/hooks/use-meal-registrations";
import { useRegistrationPhotoUri } from "@/src/lib/photo-queue";
import { useColors } from "@/src/theme/colors";
import { Pressable, ScrollView, Text, TextInput, View } from "@/src/tw";
import type { MealItem, NutritionPlanMeal, NutritionPlanOption } from "@/src/types/database";
import { cn } from "@/src/utils/cn";
import { optionFoodsText, optionLabel, type RegistrationChoice } from "@/src/utils/meal-registration";
import type { ResolvedDay } from "@/src/utils/nutrition-plan";

const SHEET_MAX_SHARE = 0.9;

export type SheetTarget = {
  meal: NutritionPlanMeal;
  name: string;
  registration: MealItem | null;
  preselectOptionId: string | null;
};

type Props = {
  target: SheetTarget | null;
  options: NutritionPlanOption[];
  day: ResolvedDay;
  cycling: boolean;
  online: boolean;
  onClose: () => void;
  onSave: (input: RegisterInput) => void;
  onUndo: (item: MealItem) => void;
};

/** The selected row: «Del plan» (the stored foods), an option, «otra cosa»
 *  or «No la comí». */
type Pick = { kind: "kept" } | { kind: "option"; id: string } | { kind: "other" } | { kind: "skipped" };

/** A plan registration whose option is gone (or was never stored). */
function keptRegistration(registration: MealItem | null, options: NutritionPlanOption[]): MealItem | null {
  if (registration == null || registration.kind === "other" || registration.kind === "skipped") return null;
  return options.some((o) => o.id === registration.plan_option_id) ? null : registration;
}

/** The registration's kind, else the option showing on the card. */
function initialPick(target: SheetTarget, options: NutritionPlanOption[]): Pick | null {
  const r = target.registration;
  if (r?.kind === "skipped") return { kind: "skipped" };
  if (r?.kind === "other") return { kind: "other" };
  if (r != null) {
    const still = options.find((o) => o.id === r.plan_option_id);
    return still != null ? { kind: "option", id: still.id } : { kind: "kept" };
  }
  const pre = options.find((o) => o.id === target.preselectOptionId) ?? options[0];
  return pre != null ? { kind: "option", id: pre.id } : null;
}

/**
 * Spec «Registration sheet»: what the client ate for one plan meal (an
 * option, «Comí otra cosa» or «No la comí»), an optional photo, and «Deshacer
 * registro» when editing. The frame is Programa's exercise sheet. The last
 * target stays rendered while the sheet slides out, and each opening starts
 * from the target's own state.
 */
export function RegistrationSheet({ target, options, onClose, ...rest }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboard = useKeyboardHeight();

  // The options belong to the target: the parent may drop them on close.
  const [shown, setShown] = useState(target != null ? { target, options } : null);
  const [opens, setOpens] = useState(target != null ? 1 : 0);
  const [wasOpen, setWasOpen] = useState(target != null);
  if (target != null && (shown?.target !== target || shown.options !== options)) setShown({ target, options });
  if ((target != null) !== wasOpen) {
    setWasOpen(target != null);
    if (target != null) setOpens((n) => n + 1);
  }

  return (
    <Modal
      visible={target != null}
      animationType="slide"
      transparent
      // Full screen on Android too, so the sheet's bottom is the screen's
      // bottom — what the keyboard height is measured from.
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel={t("common.close")}
        className="flex-1"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      />
      <View className="absolute inset-x-0" style={{ bottom: keyboard }}>
        <View
          className="rounded-t-3xl border-t border-border bg-surface"
          style={{
            paddingBottom: keyboard > 0 ? 12 : insets.bottom + 12,
            maxHeight:
              keyboard > 0 ? windowHeight - keyboard - insets.top - 12 : windowHeight * SHEET_MAX_SHARE,
          }}
        >
          <View className="items-center pt-2.5">
            <View className="h-1 w-10 rounded-full bg-border-strong" />
          </View>
          {shown != null && <SheetBody key={opens} target={shown.target} options={shown.options} {...rest} />}
        </View>
      </View>
    </Modal>
  );
}

function SheetBody({
  target,
  options,
  day,
  cycling,
  online,
  onSave,
  onUndo,
}: Omit<Props, "target" | "onClose"> & { target: SheetTarget }) {
  const { t } = useTranslation();
  const colors = useColors();
  const picker = useMealPhotoPicker();
  const { meal, name, registration } = target;
  const kept = keptRegistration(registration, options);

  const [pick, setPick] = useState<Pick | null>(() => initialPick(target, options));
  // The corrected text: the client never sees what the AI was given.
  const [text, setText] = useState(registration?.kind === "other" ? registration.name : "");
  const [photo, setPhoto] = useState<PhotoChange>({ kind: "keep" });
  const storedUri = useRegistrationPhotoUri(registration);
  const photoUri = photo.kind === "new" ? photo.photo.uri : photo.kind === "remove" ? null : storedUri;

  const other = pick?.kind === "other";
  const canSave = pick != null && (!other || text.trim() !== "");
  // On native the photo queue keeps a photo until the connection is back; on
  // web it lives in memory only, so it needs the connection now.
  const photoBlocked = !online && Platform.OS === "web";

  const takePicked = (picked: PickedPhoto | null) => {
    if (picked != null) setPhoto({ kind: "new", photo: picked });
  };
  const changePhoto = () => {
    if (Platform.OS === "web") {
      void picker.fromGallery().then(takePicked);
      return;
    }
    Alert.alert(t("mealReg.change"), undefined, [
      { text: t("meals.takePhoto"), onPress: () => void picker.fromCamera().then(takePicked) },
      { text: t("meals.fromGallery"), onPress: () => void picker.fromGallery().then(takePicked) },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  const save = () => {
    if (pick == null || !canSave) return;
    let choice: RegistrationChoice;
    if (pick.kind === "option") {
      const option = options.find((o) => o.id === pick.id);
      if (option == null) return;
      choice = { kind: "plan", option, foodsText: optionFoodsText(option, day, cycling) };
    } else if (pick.kind === "kept") {
      choice = { kind: "plan-kept" };
    } else if (pick.kind === "other") {
      choice = { kind: "other", text };
    } else {
      choice = { kind: "skipped" };
    }
    onSave({ meal, displayName: name, choice, photo });
  };

  // «Deshacer registro» asks in the sheet itself, where the link was: a
  // browser confirm() doesn't show in every web view (the tap did nothing),
  // and this reads the same on the phone. The sheet scrolls to show it.
  const scrollRef = useRef<RNScrollView>(null);
  const [askingUndo, setAskingUndo] = useState(false);
  const askUndo = () => {
    setAskingUndo(true);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  return (
    <ScrollView
      ref={scrollRef}
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="gap-2 px-4 pt-3.5"
    >
      <View className="flex-row items-baseline justify-between gap-3">
        <PosterText size={26} numberOfLines={1} className="flex-shrink">
          {name}
        </PosterText>
        {meal.time_hint != null && meal.time_hint !== "" && (
          <Text numberOfLines={1} className="flex-shrink text-[11px] font-semibold text-content-tertiary">
            {meal.time_hint}
          </Text>
        )}
      </View>

      <CapsLabel size={8.5} em={0.16} className="mb-0.5 mt-2 font-extrabold text-content-tertiary">
        {t("mealReg.whatDidYouEat")}
      </CapsLabel>

      {kept != null && (
        <RadioRow
          title={t("mealReg.fromPlan")}
          subtitle={other ? null : kept.name}
          selected={pick?.kind === "kept"}
          onPress={() => setPick({ kind: "kept" })}
        />
      )}
      {options.map((o) => (
        <RadioRow
          key={o.id}
          title={optionLabel(o, meal.nutrition_plan_options.indexOf(o), (n) => t("mealReg.optionN", { n }))}
          subtitle={other ? null : optionFoodsText(o, day, cycling)}
          selected={pick?.kind === "option" && pick.id === o.id}
          onPress={() => setPick({ kind: "option", id: o.id })}
        />
      ))}
      <RadioRow
        title={t("mealReg.ateSomethingElse")}
        subtitle={other ? null : t("mealReg.writeWhatYouAte")}
        selected={other}
        dashed
        onPress={() => setPick({ kind: "other" })}
      />
      {other && (
        <>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t("mealReg.writeWhatYouAte")}
            placeholderTextColor={colors.contentMuted}
            multiline
            autoFocus={text === ""}
            maxLength={600}
            textAlignVertical="top"
            accessibilityLabel={t("mealReg.ateSomethingElse")}
            className="min-h-[66px] rounded-[14px] border-[1.5px] border-brand-primary bg-brand-dark px-3 py-2.5 text-[13px] text-content-primary"
          />
          <View className="flex-row gap-1.5 pb-1">
            <Ionicons name="sparkles" size={11} color={colors.brandAccent} style={{ marginTop: 1 }} />
            <Text className="flex-1 text-[11px] text-content-tertiary">{t("mealReg.aiHint")}</Text>
          </View>
        </>
      )}
      {!meal.is_optional && (
        <RadioRow
          title={t("mealReg.skipped")}
          subtitle={null}
          selected={pick?.kind === "skipped"}
          quiet
          onPress={() => setPick({ kind: "skipped" })}
        />
      )}

      {pick?.kind !== "skipped" && (
        <View
          className={cn(
            "mt-1 flex-row items-center gap-3 rounded-[14px] border border-border bg-brand-dark px-3 py-2.5",
            photoUri == null && "border-dashed",
          )}
        >
          {photoUri != null ? (
            <Image source={{ uri: photoUri }} style={{ width: 40, height: 40, borderRadius: 12 }} contentFit="cover" />
          ) : (
            <View className="h-[40px] w-[40px] items-center justify-center rounded-[12px] bg-brand-primary-soft">
              <Ionicons name="camera-outline" size={19} color={colors.brandPrimary} />
            </View>
          )}
          <View className="min-w-0 flex-1 gap-1">
            <CapsLabel size={8.5} em={0.16} className="font-extrabold text-content-primary">
              {photoUri != null ? t("mealReg.platePhoto") : t("mealReg.addPhoto")}
            </CapsLabel>
            {photoBlocked ? (
              <Text className="text-[11px] text-content-tertiary">{t("mealReg.photoNeedsConnection")}</Text>
            ) : photoUri != null ? (
              <View className="flex-row gap-3">
                <SmallAction label={t("mealReg.change")} onPress={changePhoto} />
                <SmallAction label={t("meals.removePhoto")} onPress={() => setPhoto({ kind: "remove" })} />
              </View>
            ) : (
              <Text className="text-[11px] text-content-tertiary">{t("mealReg.optional")}</Text>
            )}
          </View>
          {photoUri == null && !photoBlocked && (
            <View className="flex-row gap-2">
              <PhotoButton
                icon="camera-outline"
                label={t("meals.takePhoto")}
                onPress={() => void picker.fromCamera().then(takePicked)}
              />
              <PhotoButton
                icon="images-outline"
                label={t("meals.fromGallery")}
                onPress={() => void picker.fromGallery().then(takePicked)}
              />
            </View>
          )}
        </View>
      )}

      <View className="pt-2">
        <SkewButton onPress={save} disabled={!canSave}>
          {t("common.save")}
        </SkewButton>
      </View>
      {registration != null &&
        (askingUndo ? (
          <View
            accessibilityLiveRegion="polite"
            className="mt-1 gap-2.5 rounded-2xl border border-border bg-brand-dark p-3.5"
          >
            <View className="gap-0.5">
              <Text className="text-[15px] font-bold text-content-primary">{t("mealReg.undoTitle")}</Text>
              <Text className="text-[13px] text-content-secondary">{t("mealReg.undoBody", { meal: name })}</Text>
            </View>
            <View className="flex-row gap-2.5">
              <Pressable
                onPress={() => setAskingUndo(false)}
                accessibilityRole="button"
                className="flex-1 items-center justify-center rounded-xl border border-border bg-surface py-3"
              >
                <Text className="text-[14px] font-semibold text-content-primary">{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={() => onUndo(registration)}
                accessibilityRole="button"
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border py-3"
                style={{ borderColor: colors.brandPrimary }}
              >
                <Ionicons name="arrow-undo" size={16} color={colors.brandPrimary} />
                <Text className="text-[14px] font-bold text-brand-primary">{t("mealReg.undoConfirm")}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={askUndo} accessibilityRole="button" className="items-center py-2.5">
            <CapsLabel size={9.5} em={0.1} className="font-extrabold text-content-tertiary">
              {t("mealReg.undoEntry")}
            </CapsLabel>
          </Pressable>
        ))}
    </ScrollView>
  );
}

/** One «¿Qué comiste?» choice; `subtitle` null shrinks it to its label. */
function RadioRow({
  title,
  subtitle,
  selected,
  dashed = false,
  quiet = false,
  onPress,
}: {
  title: string;
  subtitle: string | null;
  selected: boolean;
  dashed?: boolean;
  quiet?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      className={cn(
        "flex-row gap-3 rounded-[14px] border px-3",
        subtitle != null ? "items-start py-[11px]" : "items-center py-[9px]",
        selected ? "border-brand-primary bg-brand-primary-soft" : "border-border",
        !selected && (quiet ? "bg-transparent" : "bg-brand-dark"),
        dashed && "border-dashed",
      )}
    >
      <View
        className={cn(
          "h-[16px] w-[16px] items-center justify-center rounded-full",
          selected ? "border-2 border-brand-primary" : "border-[1.5px] border-content-muted",
        )}
      >
        {selected && <View className="h-[7px] w-[7px] rounded-full bg-brand-primary" />}
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <PosterText size={14} className={cn(quiet && !selected && "text-content-tertiary")}>
          {title}
        </PosterText>
        {subtitle != null && <Text className="text-[11px] text-content-tertiary">{subtitle}</Text>}
      </View>
    </Pressable>
  );
}

function PhotoButton({
  icon,
  label,
  onPress,
}: {
  icon: "camera-outline" | "images-outline";
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-[36px] w-[36px] items-center justify-center rounded-[10px] border border-border bg-surface"
    >
      <Ionicons name={icon} size={17} color={colors.contentSecondary} />
    </Pressable>
  );
}

function SmallAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button">
      <Text className="text-[11px] font-semibold text-brand-primary-light">{label}</Text>
    </Pressable>
  );
}
