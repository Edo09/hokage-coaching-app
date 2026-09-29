import { useHeaderHeight } from "expo-router/react-navigation";
import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView as RNScrollView,
} from "react-native";

import { useColors } from "@/src/theme/colors";
import { ScrollView, View } from "@/src/tw";
import { cn } from "@/src/utils/cn";

import { ScreentoneBackdrop } from "./screentone";

type ScreenProps = {
  children: React.ReactNode;
  /** Wrap content in a ScrollView (default true). */
  scroll?: boolean;
  /** Wrap in KeyboardAvoidingView — use on screens with text inputs. */
  keyboard?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  className?: string;
  contentContainerClassName?: string;
  /** Access the underlying ScrollView (e.g. to scrollTo a section). */
  scrollRef?: React.Ref<RNScrollView>;
  /** Pinned below the scroll content, above the tab bar (e.g. a sticky save bar). */
  footer?: React.ReactNode;
};

export function Screen({
  children,
  scroll = true,
  keyboard = false,
  refreshing = false,
  onRefresh,
  className,
  contentContainerClassName,
  scrollRef,
  footer,
}: ScreenProps) {
  const colors = useColors();
  const headerHeight = useHeaderHeight();

  const content = scroll ? (
    <ScrollView
      ref={scrollRef}
      className="flex-1"
      contentContainerClassName={cn("px-4 py-6 gap-5", contentContainerClassName)}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh != null ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brandPrimary}
            colors={[colors.brandPrimary]}
            progressBackgroundColor={colors.surface}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View className={cn("flex-1", contentContainerClassName)}>{children}</View>
  );

  return (
    <View className={cn("flex-1 bg-brand-dark", className)}>
      {/* Fixed behind the (transparent) scroll view. */}
      <ScreentoneBackdrop />
      {keyboard ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          // "padding" on Android too: with edge-to-edge enabled (SDK 54 default),
          // adjustResize no longer resizes the window, so KAV must do the work.
          behavior="padding"
          // Header offset is an iOS concept (translucent headers overlap
          // content); on Android it just over-pads, leaving a blank strip
          // above the keyboard.
          keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
        >
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
      {footer}
    </View>
  );
}
