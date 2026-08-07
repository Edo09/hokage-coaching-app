// Centralized query keys. Queries key on [name, userId]; invalidations use the
// bare [name] prefix so they match regardless of which user is cached.
export const qk = {
  meals: (userId: string | undefined) => ["meals", userId] as const,
  routines: (userId: string | undefined) => ["routines", userId] as const,
  progress: (userId: string | undefined) => ["progress", userId] as const,
  profile: (userId: string | undefined) => ["profile", userId] as const,
  // Read-only coaching data. The coach is shared across clients, so its key
  // carries no userId; membership is per-client.
  coach: () => ["coach"] as const,
  membership: (userId: string | undefined) => ["membership", userId] as const,
  // Shared exercise catalog, coach-managed via the Admin Web Panel.
  exercises: () => ["exercises"] as const,
  // Read-only coach-assigned multi-week program (docs/COACH-PROGRAMS-SPEC.md).
  program: (userId: string | undefined) => ["program", userId] as const,
  // The client's completion checks + logged sets against a program.
  programLog: (userId: string | undefined) => ["program-log", userId] as const,
  // Read-only coach-assigned nutrition + supplement plans
  // (docs/COACH-NUTRITION-SPEC.md). Independently assignable: a client may have
  // one, both, or neither.
  nutritionPlan: (userId: string | undefined) => ["nutrition-plan", userId] as const,
  supplementPlan: (userId: string | undefined) =>
    ["supplement-plan", userId] as const,
};

export const qkPrefixes = [
  ["meals"],
  ["routines"],
  ["progress"],
  ["profile"],
  ["program-log"],
] as const;
