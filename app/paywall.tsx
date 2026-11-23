import React from "react";

import { View } from "@/src/tw";

// The paywall's route. The screen itself arrives with the paywall task; until
// then this keeps the route (and every router.push("/paywall") that type-checks
// against it) in place.
export default function PaywallScreen() {
  return <View className="flex-1 bg-brand-dark" />;
}
