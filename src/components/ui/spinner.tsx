import React from "react";

import { Spinner as GSSpinner } from "@/components/ui/spinner";
import { loaderEnter } from "@/src/lib/motion";
import { useColors } from "@/src/theme/colors";
import { Text } from "@/src/tw";
import { AnimatedView } from "@/src/tw/animated";
import { cn } from "@/src/utils/cn";

type SpinnerProps = {
  size?: "small" | "large";
  color?: string;
};

export function Spinner({ size = "small", color }: SpinnerProps) {
  const colors = useColors();
  return <GSSpinner size={size} color={color ?? colors.brandPrimary} />;
}

type LoadingBlockProps = {
  label?: string;
  className?: string;
};

// Fades in after a short delay (loaderEnter): a quick load shows nothing
// before its content instead of flashing a spinner.
export function LoadingBlock({ label, className }: LoadingBlockProps) {
  return (
    <AnimatedView
      entering={loaderEnter()}
      className={cn("flex-1 items-center justify-center gap-3 py-16", className)}
    >
      <Spinner size="large" />
      {label != null && <Text className="text-sm text-content-tertiary">{label}</Text>}
    </AnimatedView>
  );
}
