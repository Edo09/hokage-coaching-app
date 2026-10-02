/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  reminderSyncAction,
  type ReminderSyncGate,
  sourceState,
} from "@/src/utils/reminder-sync";

const READY: ReminderSyncGate = {
  signedIn: true,
  permission: "granted",
  prefsReady: true,
  program: "ready",
  log: "ready",
  profile: "ready",
  membership: "ready",
};

const action = (patch: Partial<ReminderSyncGate>) => reminderSyncAction({ ...READY, ...patch });

describe("sourceState", () => {
  it("data, fresh or cached, is ready even if the last refetch failed", () => {
    assert.equal(sourceState({ loading: false, error: false, hasData: true }), "ready");
    assert.equal(sourceState({ loading: false, error: true, hasData: true }), "ready");
  });

  it("no data yet while the first load runs is loading", () => {
    assert.equal(sourceState({ loading: true, error: false, hasData: false }), "loading");
  });

  it("no data after a failed load is failed, not an empty answer", () => {
    assert.equal(sourceState({ loading: false, error: true, hasData: false }), "failed");
  });

  it("no data after a load that worked is a real none", () => {
    assert.equal(sourceState({ loading: false, error: false, hasData: false }), "ready");
  });
});

describe("reminderSyncAction", () => {
  it("plans once everything is in and notifications are allowed", () => {
    assert.equal(action({}), "plan");
  });

  it("waits while signed out or before the permission is known", () => {
    assert.equal(action({ signedIn: false }), "wait");
    assert.equal(action({ permission: null }), "wait");
  });

  it("cancels without permission, even before the data is in", () => {
    for (const permission of ["undetermined", "denied"] as const) {
      assert.equal(action({ permission }), "cancel", permission);
      assert.equal(action({ permission, prefsReady: false, program: "loading" }), "cancel");
    }
  });

  it("waits for the stored preferences, not the defaults", () => {
    assert.equal(action({ prefsReady: false }), "wait");
  });

  it("waits while any source is loading or failed with nothing cached", () => {
    for (const source of ["program", "log", "profile", "membership"] as const) {
      for (const state of ["loading", "failed"] as const) {
        assert.equal(action({ [source]: state }), "wait", `${source} ${state}`);
      }
    }
  });
});
