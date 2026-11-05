import * as ImagePicker from "expo-image-picker";
import { useTranslation } from "react-i18next";
import { Alert, Platform } from "react-native";

import type { PickedPhoto } from "@/src/hooks/use-meal-registrations";

// No base64: the photo queue copies the file and uploads its bytes.
const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  quality: 0.5,
  base64: false,
  allowsEditing: false,
  exif: false,
};

function toPicked(result: ImagePicker.ImagePickerResult): PickedPhoto | null {
  const asset = result.canceled ? null : result.assets[0];
  if (asset == null) return null;
  return { uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" };
}

/** The meal photo from the camera or the gallery; null when cancelled. A
 *  refused camera says so in an alert: a toast would draw under the sheet's
 *  Modal. */
export function useMealPhotoPicker(): {
  fromCamera(): Promise<PickedPhoto | null>;
  fromGallery(): Promise<PickedPhoto | null>;
} {
  const { t } = useTranslation();

  const fromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      // Alert.alert is a no-op on web.
      if (Platform.OS === "web") globalThis.alert?.(t("meals.cameraPermission"));
      else Alert.alert(t("meals.cameraPermission"));
      return null;
    }
    return toPicked(await ImagePicker.launchCameraAsync(PICKER_OPTIONS));
  };

  const fromGallery = async () => toPicked(await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS));

  return { fromCamera, fromGallery };
}
