import React from "react";

import { View } from "@/src/tw";

import { HeaderPanel } from "./header-panel";
import { DashLabel, PosterText } from "./poster";

type TabHeaderProps = {
  /** The tab's name, set as a poster title (Anton, caps). */
  title: string;
  /** Red-dash line under the title: where you are (week, date, account). */
  context?: string | null;
  /** Right-side slot, vertically centred on the title block (e.g. the ⋮ menu). */
  right?: React.ReactNode;
};

/**
 * Header for the main tabs (Programa, Nutrición, Progreso, Perfil): the home
 * panel's gradient and skewed ghost with the tab name as a poster title and a
 * red-dash context line. Compact and fixed above the content, unlike home's
 * scrolling greeting; the hairline separates what scrolls under it.
 * Sub-screens (settings, meal forms) keep the plain navigation header.
 */
export function TabHeader({ title, context, right }: TabHeaderProps) {
  return (
    <HeaderPanel className="border-b border-border">
      <View className="flex-row items-center gap-3">
        <View accessibilityRole="header" className="flex-1">
          <PosterText size={24} numberOfLines={1} adjustsFontSizeToFit>
            {title}
          </PosterText>
          {context != null && context !== "" && <DashLabel className="mt-2">{context}</DashLabel>}
        </View>
        {right}
      </View>
    </HeaderPanel>
  );
}
