import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/src/theme/colors";
import { Pressable, Text, TextInput, View } from "@/src/tw";
import { cn } from "@/src/utils/cn";

export type SearchableSelectOption = {
  label: string;
  value: string;
  /** Secondary line under the label (e.g. muscle group). Also searched. */
  sublabel?: string;
};

type SearchableSelectFieldProps = {
  label?: string;
  /** Picker header title; falls back to `label`, then `placeholder`. */
  title?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Shown when the search matches nothing. */
  emptyText?: string;
  value: string | null;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  helper?: string;
  containerClassName?: string;
};

// Case- and accent-insensitive ("prés" matches "press", "PRESS", "prêss").
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

/**
 * Select for long option lists (e.g. the exercise catalog): a full-screen
 * modal with a search box over a virtualized list, instead of cramming
 * hundreds of rows into gluestack's actionsheet. For short static lists,
 * SelectField remains the right choice.
 */
export function SearchableSelectField({
  label,
  title,
  placeholder,
  searchPlaceholder,
  emptyText,
  value,
  options,
  onChange,
  helper,
  containerClassName,
}: SearchableSelectFieldProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return options;
    return options.filter((o) => fold(`${o.label} ${o.sublabel ?? ""}`).includes(q));
  }, [options, query]);

  const openPicker = () => {
    setQuery("");
    // Deferred one tick: on web the modal would otherwise mount mid-gesture
    // and the tail of the same click would land on (and select) whichever
    // row renders under the pointer.
    setTimeout(() => setOpen(true), 0);
  };

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <View className={cn("gap-1.5", containerClassName)}>
      {label != null && (
        <Text className="text-sm font-medium text-content-secondary">{label}</Text>
      )}

      <Pressable
        onPress={openPicker}
        accessibilityRole="button"
        className="bg-surface border border-border rounded-xl flex-row items-center gap-2 py-3"
        style={{ paddingHorizontal: 24 }}
      >
        <Text
          className={cn(
            "flex-1 text-base",
            selected != null ? "text-content-primary" : "text-content-muted",
          )}
          numberOfLines={1}
        >
          {selected?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.contentMuted} />
      </Pressable>

      {helper != null && <Text className="text-xs text-content-tertiary">{helper}</Text>}

      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <View className="flex-1 bg-brand-dark" style={{ paddingTop: insets.top }}>
          <View className="flex-row items-center gap-3 px-4 py-3">
            <Text className="flex-1 text-lg font-semibold text-content-primary">
              {title ?? label ?? placeholder}
            </Text>
            <Pressable
              onPress={() => setOpen(false)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
            >
              <Ionicons name="close" size={26} color={colors.contentPrimary} />
            </Pressable>
          </View>

          <View className="mx-4 mb-2 flex-row items-center gap-2 bg-surface border border-border rounded-xl px-4">
            <Ionicons name="search" size={18} color={colors.contentMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.contentMuted}
              className="flex-1 py-3 text-base text-content-primary"
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable
                onPress={() => setQuery("")}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("common.close")}
              >
                <Ionicons name="close-circle" size={18} color={colors.contentMuted} />
              </Pressable>
            )}
          </View>

          <FlatList
            style={{ flex: 1 }}
            data={filtered}
            showsVerticalScrollIndicator={false}
            keyExtractor={(o) => o.value}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
            ListEmptyComponent={
              emptyText != null ? (
                <Text className="text-center text-content-tertiary px-6 py-10">
                  {emptyText}
                </Text>
              ) : null
            }
            renderItem={({ item }) => {
              const isSelected = item.value === value;
              return (
                <Pressable
                  onPress={() => pick(item.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  className="flex-row items-center gap-3 px-6 py-3.5 border-b border-border active:opacity-70"
                >
                  <View className="flex-1">
                    <Text
                      className={cn(
                        "text-base",
                        isSelected
                          ? "text-brand-accent font-semibold"
                          : "text-content-primary",
                      )}
                    >
                      {item.label}
                    </Text>
                    {item.sublabel != null && (
                      <Text className="text-content-tertiary text-sm mt-0.5">
                        {item.sublabel}
                      </Text>
                    )}
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark" size={20} color={colors.brandAccent} />
                  )}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}
