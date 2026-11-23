import { router } from "expo-router";
import React from "react";

import { ContentGateView } from "@/src/components/premium/content-gate-view";
import { ProgramHomeCard } from "@/src/components/program/program-home-card";
import { useContentGate } from "@/src/hooks/use-content-gate";
import { View } from "@/src/tw";
import type { ProgramWithDetails } from "@/src/types/database";

type Props = {
  program: ProgramWithDetails | null;
  notStarted: boolean;
  /** The program query is still on its first load. */
  loading: boolean;
};

/**
 * What Home shows under «Tu programa»: the program card when there is a
 * program and access, otherwise the same states as the training tab
 * (request, request sent, access ended), as a card.
 */
export function HomeProgramSlot({ program, notStarted, loading }: Props) {
  const gate = useContentGate("program", program != null);

  if (program != null && gate.kind === "content") {
    return (
      <View className="px-5">
        <ProgramHomeCard
          program={program}
          notStarted={notStarted}
          onPress={() => router.push("/(tabs)/routines")}
        />
      </View>
    );
  }

  const shown =
    gate.kind === "empty" || gate.kind === "pending" || gate.kind === "locked" ? gate : null;
  // An empty slot waits for the program query: its content would replace the
  // button the moment it arrives.
  if (shown != null && !(loading && shown.kind === "empty")) {
    return (
      <View className="px-5">
        <ContentGateView kind="program" shown={shown} variant="card" />
      </View>
    );
  }

  return (
    <View className="px-5">
      <View className="h-[168px] rounded-[20px] border border-border bg-surface" />
    </View>
  );
}
