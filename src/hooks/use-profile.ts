import { enqueue } from "@/src/lib/outbox";
import { emptyProfile, overlayProfile } from "@/src/lib/outbox-overlay";
import { qk } from "@/src/lib/query-keys";
import { Profile } from "@/src/types/database";
import { supabase } from "@/src/utils/supabase";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

async function fetchProfile(userId: string): Promise<Profile | null> {
  // maybeSingle: a profile that only exists as a pending offline upsert has
  // no server row yet — the overlay supplies it.
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return overlayProfile(userId, data as Profile | null);
}

export function useProfile(userId: string | undefined) {
  const queryClient = useQueryClient();
  const profileKey = qk.profile(userId);

  const { data: profile = null, isPending: loading } = useQuery({
    queryKey: profileKey,
    queryFn: () => fetchProfile(userId!),
    enabled: !!userId,
  });

  // Local-first upsert: merge into the cache, queue the op. Also used by
  // onboarding, where no server row exists yet.
  const updateProfileMutation = useMutation({
    mutationFn: async (updates: Partial<Profile>) => {
      const now = new Date().toISOString();
      queryClient.setQueryData<Profile | null>(profileKey, (old) => ({
        ...(old ?? emptyProfile(userId!)),
        ...updates,
        updated_at: now,
      }));
      await enqueue({
        userId: userId!,
        table: "profiles",
        kind: "upsert",
        payload: { id: userId!, ...updates, updated_at: now },
      });
    },
  });

  return { profile, loading, updateProfile: updateProfileMutation.mutateAsync };
}
