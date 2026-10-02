import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import React from "react";
import { useTranslation } from "react-i18next";

import { Pressable, View } from "@/src/tw";

/** GIF/WebP demos are animated images (expo-image); anything else is video. */
export const isImageDemo = (uri: string): boolean =>
  /\.(gif|apng|webp|png|jpe?g)$/i.test(uri.split("?")[0]);

/**
 * An exercise's demo, playing inline: in the exercise sheet, and in the check
 * card for the exercise that comes next. With `onExpand`, a corner button
 * opens it full screen. Key it by uri, so a new exercise re-creates the
 * player.
 */
export function DemoMedia({
  uri,
  height = 200,
  onExpand,
}: {
  uri: string;
  height?: number;
  onExpand?: (uri: string) => void;
}) {
  const { t } = useTranslation();
  const image = isImageDemo(uri);
  return (
    <View
      className="overflow-hidden rounded-2xl"
      // The catalog's GIFs are drawn on white; videos letterbox on black.
      style={{ height, backgroundColor: image ? "#ffffff" : "#000000" }}
    >
      {image ? (
        <Image
          source={{ uri }}
          style={{ width: "100%", height: "100%" }}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={150}
        />
      ) : (
        <InlineVideo uri={uri} />
      )}
      {onExpand != null && (
        <Pressable
          onPress={() => onExpand(uri)}
          accessibilityRole="button"
          accessibilityLabel={t("program.demoFullScreen")}
          hitSlop={6}
          className="absolute right-2 top-2 h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
        >
          <Ionicons name="expand" size={17} color="#ffffff" />
        </Pressable>
      )}
    </View>
  );
}

/** Muted and looping, like the GIF demos; controls live in full screen. */
function InlineVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <VideoView
      style={{ width: "100%", height: "100%" }}
      player={player}
      contentFit="contain"
      nativeControls={false}
    />
  );
}
