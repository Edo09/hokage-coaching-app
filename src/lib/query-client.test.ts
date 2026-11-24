import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";

import { queryClient } from "./query-client";

// setTimeout keeps its delay in a signed 32-bit integer, and a longer delay
// fires at once (browsers and Node alike). The gc timer of a query nobody
// observes is such a delay, so a gcTime over that limit drops the query as soon
// as it is created or restored from the persisted cache.
test("a query nobody observes is not dropped by its own gc timer", async () => {
  // A fresh client with the app's own defaults: setQueryData builds a query
  // with no observer, which arms its gc timer.
  const client = new QueryClient({ defaultOptions: queryClient.getDefaultOptions() });
  try {
    client.setQueryData(["restored"], { kept: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(client.getQueryData(["restored"]), { kept: true });
  } finally {
    // Clearing also cancels the gc timers, or the test run would wait on them.
    client.clear();
  }
});
