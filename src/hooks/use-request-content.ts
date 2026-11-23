import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useAuth } from "@/src/hooks/use-auth";
import { premiumContentKeys, qk } from "@/src/lib/query-keys";
import type { ContentRequest, ContentRequestKind } from "@/src/types/database";
import { classifyRequestError, upsertRequest, type RequestError } from "@/src/utils/content-request";
import { supabase } from "@/src/utils/supabase";

export type RequestResult = { ok: true } | { ok: false; error: RequestError };

/**
 * Sends «Solicitar programa» / «Solicitar Plan de nutrición»: rpc
 * request_content, the only way a request is made (there is no INSERT policy),
 * and online only. A request already pending comes back as that request, so a
 * double tap is harmless. What the server refuses is classified for the sheet
 * (src/utils/content-request.ts); this also makes the screens catch up with
 * what the refusal says: access that lapsed behind the screen, or content the
 * coach assigned in the meantime.
 */
export function useRequestContent() {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);

  const send = useCallback(
    async (kind: ContentRequestKind, note: string): Promise<RequestResult> => {
      if (userId == null) return { ok: false, error: "failed" };
      if (!onlineManager.isOnline()) return { ok: false, error: "offline" };
      setSending(true);
      try {
        const trimmed = note.trim();
        const { data, error } = await supabase.rpc("request_content", {
          p_kind: kind,
          p_note: trimmed === "" ? null : trimmed,
        });
        if (error) {
          const failure = classifyRequestError(error);
          if (failure === "premium_required") {
            void queryClient.invalidateQueries({ queryKey: qk.access(userId) });
          } else if (failure === "already_assigned") {
            for (const queryKey of premiumContentKeys) {
              void queryClient.invalidateQueries({ queryKey });
            }
          }
          return { ok: false, error: failure };
        }
        queryClient.setQueryData<ContentRequest[]>(qk.contentRequests(userId), (old) =>
          upsertRequest(old ?? [], data as ContentRequest),
        );
        return { ok: true };
      } catch (error) {
        return { ok: false, error: classifyRequestError(error) };
      } finally {
        setSending(false);
      }
    },
    [userId, queryClient],
  );

  return { send, sending };
}
