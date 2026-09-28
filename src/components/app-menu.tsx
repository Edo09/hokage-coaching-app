import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
  ActionsheetItem,
  ActionsheetItemText,
} from "@/components/ui/actionsheet";
import { useAuth } from "@/src/hooks/use-auth";
import { useColors } from "@/src/theme/colors";
import { Pressable } from "@/src/tw";
import { cn } from "@/src/utils/cn";

/**
 * The "⋮" menu (profile, settings, sign out), shared by the home header and
 * the profile header. The item for the screen you're already on is left out.
 */
export function AppMenu({ className }: { className?: string }) {
  const colors = useColors();
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const go = (href: "/(tabs)/profile" | "/(tabs)/settings") => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t("common.menu")}
        className={cn(
          "w-11 h-11 rounded-xl bg-surface items-center justify-center border border-border",
          className,
        )}
      >
        <Ionicons name="ellipsis-vertical" size={18} color={colors.contentSecondary} />
      </Pressable>

      <Actionsheet isOpen={open} onClose={() => setOpen(false)}>
        <ActionsheetBackdrop />
        <ActionsheetContent>
          <ActionsheetDragIndicatorWrapper>
            <ActionsheetDragIndicator />
          </ActionsheetDragIndicatorWrapper>
          {pathname !== "/profile" && (
            <ActionsheetItem onPress={() => go("/(tabs)/profile")}>
              <Ionicons name="person-outline" size={20} color={colors.contentSecondary} />
              <ActionsheetItemText>{t("tabs.profile")}</ActionsheetItemText>
            </ActionsheetItem>
          )}
          {/* Theme/language/unit toggles live in Settings */}
          <ActionsheetItem onPress={() => go("/(tabs)/settings")}>
            <Ionicons name="settings-outline" size={20} color={colors.contentSecondary} />
            <ActionsheetItemText>{t("settings.title")}</ActionsheetItemText>
          </ActionsheetItem>
          <ActionsheetItem
            onPress={() => {
              setOpen(false);
              signOut();
            }}
          >
            <Ionicons name="log-out-outline" size={20} color={colors.error} />
            <ActionsheetItemText className="text-error">{t("auth.signOut")}</ActionsheetItemText>
          </ActionsheetItem>
        </ActionsheetContent>
      </Actionsheet>
    </>
  );
}
