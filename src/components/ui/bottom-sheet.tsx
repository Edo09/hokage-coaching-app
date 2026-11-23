import React from "react";
import { useTranslation } from "react-i18next";
import { Modal, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useKeyboardHeight } from "@/src/hooks/use-keyboard-height";
import { Pressable, View } from "@/src/tw";

const SHEET_MAX_SHARE = 0.9;

type Props = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

/**
 * A bottom sheet in a Modal: scrim (tap to close), a handle, rounded top, and
 * room for the keyboard. The frame of the meal registration sheet, for sheets
 * with a text field. It renders its children whenever it is mounted; the
 * caller decides what stays rendered while it slides out.
 */
export function BottomSheet({ visible, onClose, children }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboard = useKeyboardHeight();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      // Full screen on Android too, so the sheet's bottom is the screen's
      // bottom, which is what the keyboard height is measured from.
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
          {children}
        </View>
      </View>
    </Modal>
  );
}
