import { clearOutbox } from "@/src/lib/outbox";
import { persister, queryClient } from "@/src/lib/query-client";
import { cancelReminders } from "@/src/lib/reminders";
import { supabase } from "@/src/utils/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Session, User } from "@supabase/supabase-js";
import React, { createContext, useEffect, useState } from "react";

type AuthContextType = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  onboardingCompleted: boolean | null;
  markOnboarded: () => void;
};

export const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  onboardingCompleted: null,
  markOnboarded: () => {},
});

const ONBOARDED_KEY = (userId: string) => `hokage-onboarded-${userId}`;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);

  // Offline-safe: last-known status from AsyncStorage first, then the network
  // truth. A network failure must never regress an onboarded user to false —
  // that redirects them into onboarding, where saving also needs the network.
  const loadOnboardingStatus = async (userId: string) => {
    let cached: string | null = null;
    try {
      cached = await AsyncStorage.getItem(ONBOARDED_KEY(userId));
    } catch {}
    if (cached != null) setOnboardingCompleted(cached === "1");

    const { data, error } = await supabase
      .from("profiles")
      .select("onboarding_completed")
      .eq("id", userId)
      .maybeSingle();
    if (!error) {
      const completed = data?.onboarding_completed ?? false;
      setOnboardingCompleted(completed);
      try {
        await AsyncStorage.setItem(ONBOARDED_KEY(userId), completed ? "1" : "0");
      } catch {}
    } else if (cached == null) {
      // Unknown status and the fetch failed. Defaulting to true is the safe
      // side: worst case a new user lands in tabs and completes their profile
      // from the Profile tab, instead of an onboarded user being trapped.
      setOnboardingCompleted(true);
    }
  };

  const markOnboarded = () => {
    const userId = session?.user?.id;
    setOnboardingCompleted(true);
    if (userId) {
      AsyncStorage.setItem(ONBOARDED_KEY(userId), "1").catch(() => {});
    }
  };

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        loadOnboardingStatus(session.user.id);
      }
      setLoading(false);
    }).catch((error) => {
      console.error("[Auth] Error getting session:", error);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (session?.user) {
        loadOnboardingStatus(session.user.id);
      } else {
        setOnboardingCompleted(null);
      }
      if (event === "SIGNED_OUT") {
        // Wipe everything account-scoped so the next sign-in can't see the
        // previous user's cached data or replay their queued writes, or get
        // reminders built from them.
        void clearOutbox();
        void cancelReminders();
        queryClient.clear();
        void persister.removeClient();
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext value={{
      session,
      user: session?.user ?? null,
      loading,
      onboardingCompleted,
      markOnboarded,
    }}>
      {children}
    </AuthContext>
  );
}
