import { unregisterPushToken } from "@/src/lib/push";
import { AuthContext } from "@/src/providers/auth-provider";
import { supabase } from "@/src/utils/supabase";
import React from "react";

export function useAuth() {
  const context = React.useContext(AuthContext);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name },
      },
    });
    if (error) throw error;
    // With "Confirm email" enabled in Supabase Auth, signUp succeeds but
    // returns no session — the user must verify before signing in. (Also the
    // anti-enumeration response for an already-registered email.)
    return { needsEmailConfirmation: data.session == null };
  };

  const signOut = async () => {
    // Before signing out: the delete needs this session (RLS), and the next
    // account on this phone must not get this client's pushes.
    await unregisterPushToken();
    // scope "local" only clears this device's session; cache/outbox cleanup
    // happens on the SIGNED_OUT event in the auth provider.
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
  };

  return {
    ...context,
    signIn,
    signUp,
    signOut,
  };
}
