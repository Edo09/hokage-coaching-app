import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { Pressable, View } from "@/src/tw";

/** GIF/WebP demos are animated images (expo-image); anything else is video. */
export const isImageDemo = (uri: string): boolean =>
  /\.(gif|apng|webp|png|jpe?g)$/i.test(uri.split("?")[0]);

/**
 * An exercise's demo, playing inline: in the exercise sheet, and in the check
 * card for the exercise that comes next. Sized by `height`, a band that tall
 * across its parent (the card), or by `maxHeight`: in its own shape (a video
 * is taken as 16:9), as wide as its parent but no taller than that (the
 * sheet). With `onExpand`, a corner button opens it full screen. Key it by
 * uri, so a new exercise re-creates the player.
 */
export function DemoMedia({
  uri,
  height,
  maxHeight,
  onExpand,
}: { uri: string; onExpand?: (uri: string) => void } & (
  | { height: number; maxHeight?: undefined }
  | { maxHeight: number; height?: undefined }
)) {
  const { t } = useTranslation();
  const image = isImageDemo(uri);
  // Its shape, width over height. An image's once it has loaded, square until
  // then, as the catalog's GIFs are (180×180); a video is taken as 16:9.
  const [aspect, setAspect] = useState(image ? 1 : 16 / 9);
  const box = (
    <View
      className="overflow-hidden rounded-2xl"
      // The catalog's GIFs are drawn on white; videos letterbox on black.
      style={[
        height != null ? { height } : { width: "100%", aspectRatio: aspect },
        { backgroundColor: image ? "#ffffff" : "#000000" },
      ]}
    >
      {image ? (
        <Image
          source={{ uri }}
          style={{ width: "100%", height: "100%" }}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={150}
          onLoad={({ source }) => {
            if (source.width > 0 && source.height > 0) setAspect(source.width / source.height);
          }}
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
  if (maxHeight == null) return box;
  // The cap goes on a wrapper: on native, Yoga works out an aspect-ratio box's
  // height before its own maxWidth narrows it, so the box would lose its shape.
  return (
    <View className="w-full self-center" style={{ maxWidth: maxHeight * aspect }}>
      {box}
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
