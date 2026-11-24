import { useContentRequests } from "@/src/hooks/use-content-requests";
import { usePremiumAccess } from "@/src/hooks/use-premium-access";
import { useRefreshOnFocus } from "@/src/hooks/use-refresh-on-focus";
import {
  contentGate,
  requestKindOf,
  type ContentGate,
  type GateKind,
} from "@/src/utils/subscription";

/**
 * What a tab (or Home's program card) shows in place of, or as, the coach's
 * content: the spec's table of screen states, from the client's access, their
 * requests and whether the content is in hand (`hasContent`: the tab's own
 * query returned it). The rules are src/utils/subscription.ts's; this joins
 * them to the hooks and asks again when the tab regains focus, since access
 * may have started or ended while the client was elsewhere.
 */
export function useContentGate(gate: GateKind, hasContent: boolean): ContentGate {
  const { access, state, refresh } = usePremiumAccess();
  const requests = useContentRequests();
  useRefreshOnFocus(refresh);

  const kind = requestKindOf(gate);
  return contentGate({
    gate,
    state,
    access,
    hasContent,
    pending: kind != null ? requests.pending(kind) : null,
    requestsLoading: requests.loading,
    // Requests are offered while the switch is off too: the panel shows the
    // coach who asked for what (Dashboard, bell, client page), so a button no
    // longer promises an answer nobody sees. `__DEV__` here would hide them
    // from release builds again until the switch is on.
    requestsEnabledWhileOpen: true,
  });
}
