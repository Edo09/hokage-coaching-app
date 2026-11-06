import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/src/hooks/use-auth";
import { syncCustomSounds } from "@/src/lib/custom-sounds";
import { qk } from "@/src/lib/query-keys";
import { setSoundRow } from "@/src/lib/sound-choice";
import { customSoundFiles } from "@/src/utils/sound-sets";
import { supabase } from "@/src/utils/supabase";

// The coach's «Sonidos de la app» (the panel's Ajustes, one row in
// public.app_sound_settings): read when the app opens and whenever it comes
// back to the front, and kept on the device (src/lib/sound-choice.ts), with
// the coach's own files downloaded (src/lib/custom-sounds.ts). A failed read
// keeps the last one. Mounted once, in the tabs layout.

const COLUMNS =
  "rest_start, rest_warn, rest_done, new_record, day_complete, " +
  "rest_start_file, rest_warn_file, rest_done_file, new_record_file, day_complete_file";

export function useSoundChoiceSync(): void {
  const { user } = useAuth();
  const { data, refetch } = useQuery({
    queryKey: qk.appSounds(),
    queryFn: async () => {
      const { data, error } = await supabase.from("app_sound_settings").select(COLUMNS).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Record<string, unknown> | null;
    },
    enabled: user != null,
  });

  useEffect(() => {
    if (data === undefined) return;
    setSoundRow(data);
    void syncCustomSounds(Object.values(customSoundFiles(data)));
  }, [data]);

  useEffect(() => {
    if (user == null) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refetch();
    });
    return () => sub.remove();
  }, [user, refetch]);
}
