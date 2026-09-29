import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Height of the on-screen keyboard, 0 while it's hidden.
 *
 * For sheets inside a `Modal`, where nothing resizes for the keyboard on
 * Android: the Modal is its own window, and with edge-to-edge (enforced from
 * Android 15) `adjustResize` no longer shrinks windows anyway. iOS reports
 * the change before it animates, and the layout change rides the keyboard's
 * own animation.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) => {
      if (ios) Keyboard.scheduleLayoutAnimation(e);
      setHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", (e) => {
      if (ios) Keyboard.scheduleLayoutAnimation(e);
      setHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
