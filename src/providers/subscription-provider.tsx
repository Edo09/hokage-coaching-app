import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef } from "react";

import { useAuth } from "@/src/hooks/use-auth";
import { usePremiumAccess } from "@/src/hooks/use-premium-access";
import { useRealtimeInvalidate } from "@/src/hooks/use-realtime-invalidate";
import { useSyncSubscription } from "@/src/hooks/use-sync-subscription";
import { tickAccessClock, useAccessClock } from "@/src/lib/access-clock";
import { premiumContentKeys, qk } from "@/src/lib/query-keys";
import { purchases } from "@/src/lib/purchases";
import { createRenewalChecker, RENEWAL_CHECK_DELAY_MS } from "@/src/lib/renewal-check";
import { msUntilAccessEnds, needsRenewalSync } from "@/src/utils/subscription";

/**
 * Premium's side effects, mounted once under AuthProvider (docs/superpowers/
 * specs/2026-11-16-premium-subscriptions-design.md, «The app»). It renders its
 * children and decides nothing: access is the server's answer (usePremiumAccess),
 * and the SDK's updates only make the app read that answer again.
 *
 * - starts the purchases SDK once, without a user; logs the client in when the
 *   session starts and out when it ends;
 * - a change of the SDK's customer invalidates the access query;
 * - Realtime on the client's subscription, membership and requests;
 * - ticks the access clock when access is due to end, so screens flip (a
 *   renewing subscription gets a grace, src/utils/subscription.ts);
 * - when a renewing subscription's period has ended and the answer in hand
 *   still holds it, asks the server to re-read the store (the repair for a
 *   renewal Realtime never delivered);
 * - when access starts or ends, the coach's content is read again (the lock
 *   hides it from the database; a stale copy must not linger).
 */
export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const { access, locked, updatedAt } = usePremiumAccess();
  const now = useAccessClock();

  useEffect(() => {
    purchases.configure();
  }, []);

  // The SDK's user follows the session. A sign-out only resets a user this
  // run had logged in; a cold start without a session has nothing to reset.
  const hadUser = useRef(false);
  useEffect(() => {
    if (userId != null) {
      hadUser.current = true;
      purchases.identify(userId).catch(() => {});
    } else if (hadUser.current) {
      hadUser.current = false;
      void purchases.reset();
    }
  }, [userId]);

  useEffect(() => {
    if (userId == null) return;
    return purchases.onCustomerInfoChange(() => {
      void queryClient.invalidateQueries({ queryKey: qk.access(userId) });
    });
  }, [userId, queryClient]);

  useRealtimeInvalidate("subscriptions", userId ? `user_id=eq.${userId}` : undefined, qk.access(userId));
  useRealtimeInvalidate("memberships", userId ? `client_id=eq.${userId}` : undefined, qk.access(userId));
  useRealtimeInvalidate(
    "content_requests",
    userId ? `user_id=eq.${userId}` : undefined,
    qk.contentRequests(userId),
  );

  // Aimed at the end of access. `now` re-arms it: a delay is clamped to what
  // setTimeout can hold, so a far-off end fires early and is aimed again.
  useEffect(() => {
    const ms = msUntilAccessEnds(access, new Date());
    if (ms == null) return;
    const timer = setTimeout(tickAccessClock, ms);
    return () => clearTimeout(timer);
  }, [access, now]);

  // A renewing subscription whose period has ended and whose renewal the app
  // has not heard of (the answer in hand still holds the old period): ask the
  // server to re-read the store. Realtime, or the refetch on returning to the
  // app, normally delivers the renewal first, so this waits a moment and looks
  // at what is then in hand; every read of the answer looks again.
  const sync = useSyncSubscription();
  const renewalCheck = useRef<ReturnType<typeof createRenewalChecker> | null>(null);
  useEffect(() => {
    renewalCheck.current =
      userId == null ? null : createRenewalChecker({ sync, now: () => new Date() });
  }, [userId, sync]);
  const renewalMissing = needsRenewalSync(access, now);
  useEffect(() => {
    if (!renewalMissing) return;
    const timer = setTimeout(() => {
      void renewalCheck.current?.(access);
    }, RENEWAL_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [renewalMissing, now, access, updatedAt]);

  // Access started or ended (not the first read): the lock changes what the
  // coach's content queries return.
  const wasLocked = useRef<boolean | null>(null);
  useEffect(() => {
    if (access == null) return;
    if (wasLocked.current != null && wasLocked.current !== locked) {
      for (const queryKey of premiumContentKeys) {
        void queryClient.invalidateQueries({ queryKey });
      }
    }
    wasLocked.current = locked;
  }, [access, locked, queryClient]);

  return <>{children}</>;
}
