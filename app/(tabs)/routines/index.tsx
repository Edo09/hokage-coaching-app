import React, { useEffect, useRef, useState } from "react";
import type { ScrollView as RNScrollView } from "react-native";

import { ContentGateView } from "@/src/components/premium/content-gate-view";
import { ProgramView } from "@/src/components/program/program-view";
import { ErrorState, LoadingBlock, Screen } from "@/src/components/ui";
import { useContentGate } from "@/src/hooks/use-content-gate";
import { useProgram } from "@/src/hooks/use-program";
import { useRefreshOnFocus } from "@/src/hooks/use-refresh-on-focus";
import { useArrival } from "@/src/lib/motion";
import { type ProgramFocus, programFocus, useProgramFocus } from "@/src/lib/program-focus";
import { View } from "@/src/tw";

// Coach app = programs only. The client follows the single active coach program
// (self-made routines + the AI generator live in the SOLO app, not here). When
// there is none to show, what the client can do about it (Premium): ask the
// coach for one, see that the request was sent, subscribe, or renew — refetched
// on focus so a freshly assigned program appears on return.
export default function RoutinesScreen() {
  const {
    program,
    week,
    selectedWeek,
    autoWeek,
    setViewWeek,
    notStarted,
    loading,
    error,
    refresh,
  } = useProgram();
  useRefreshOnFocus(refresh);
  // Access first: a client whose access ended sees the locked state even when
  // a copy of the program is still cached.
  const gate = useContentGate("program", program != null);
  const arrive = useArrival(loading && program == null);
  const scrollRef = useRef<RNScrollView>(null);

  // «Ir al Día n» (the day-complete modal) asks for a week and a day: select
  // the week here (null for the current one, like the week picker), and
  // ProgramView opens the day and scrolls to it. Waits for the program, so a
  // request made before this tab ever mounted still lands.
  const requested = useProgramFocus();
  const [focus, setFocus] = useState<ProgramFocus | null>(null);
  if (requested != null && program != null && requested !== focus) {
    setFocus(requested);
    setViewWeek(requested.week === autoWeek ? null : requested.week);
  }
  // Handed over: coming back to the tab later doesn't replay it.
  useEffect(() => {
    if (focus != null) programFocus.take();
  }, [focus]);

  if (loading && program == null) {
    return (
      <View className="flex-1 bg-brand-dark">
        <LoadingBlock />
      </View>
    );
  }

  if (error && program == null) {
    return (
      <View className="flex-1 bg-brand-dark">
        <ErrorState onRetry={refresh} />
      </View>
    );
  }

  const shown =
    gate.kind === "empty" || gate.kind === "pending" || gate.kind === "locked" ? gate : null;

  return (
    <View className="flex-1 bg-brand-dark">
      {program != null && gate.kind === "content" ? (
        <Screen
          entering={arrive}
          onRefresh={refresh}
          scrollRef={scrollRef}
          contentContainerClassName="p-4 gap-3 pb-24"
        >
          <ProgramView
            program={program}
            week={week}
            selectedWeek={selectedWeek}
            autoWeek={autoWeek}
            onSelectWeek={setViewWeek}
            notStarted={notStarted}
            focus={focus}
            scrollRef={scrollRef}
          />
        </Screen>
      ) : shown != null ? (
        <View className="flex-1 items-center justify-center px-6">
          <ContentGateView kind="program" shown={shown} variant="screen" />
        </View>
      ) : (
        <LoadingBlock />
      )}
    </View>
  );
}
