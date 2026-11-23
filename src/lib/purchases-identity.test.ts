/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createIdentity, type IdentitySdk } from "@/src/lib/purchases-identity";

/** A fake SDK that records the calls that change who it is. */
function fakeSdk(opts: { holdLogIn?: boolean; logInFails?: boolean; logOutFails?: boolean } = {}) {
  const calls: string[] = [];
  let current = "$RCAnonymousID:abc";
  let anonymous = true;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sdk: IdentitySdk = {
    async logIn(id) {
      calls.push(`logIn:${id}`);
      if (opts.holdLogIn) await held;
      if (opts.logInFails) throw new Error("login failed");
      current = id;
      anonymous = false;
    },
    async logOut() {
      calls.push("logOut");
      if (opts.logOutFails) throw new Error("logout failed");
      current = "$RCAnonymousID:new";
      anonymous = true;
    },
    getAppUserID: async () => current,
    isAnonymous: async () => anonymous,
  };
  return {
    sdk,
    calls,
    release,
    /** The SDK ends up on another user behind the helper's back. */
    switchTo: (id: string) => {
      current = id;
      anonymous = false;
    },
  };
}

describe("createIdentity.identify", () => {
  it("logs a user in once", async () => {
    const { sdk, calls } = fakeSdk();
    const identity = createIdentity(sdk);
    await identity.identify("u1");
    await identity.identify("u1");
    assert.deepEqual(calls, ["logIn:u1"]);
  });

  it("logs the next user in when the account changes", async () => {
    const { sdk, calls } = fakeSdk();
    const identity = createIdentity(sdk);
    await identity.identify("u1");
    await identity.identify("u2");
    assert.deepEqual(calls, ["logIn:u1", "logIn:u2"]);
  });

  it("rejects when the login fails, and tries again next time", async () => {
    const { sdk, calls } = fakeSdk({ logInFails: true });
    const identity = createIdentity(sdk);
    await assert.rejects(identity.identify("u1"), /login failed/);
    await assert.rejects(identity.identify("u1"), /login failed/);
    assert.deepEqual(calls, ["logIn:u1", "logIn:u1"]);
  });
});

describe("createIdentity.ensure", () => {
  it("waits for a login in flight and does not repeat it: a purchase never goes to the wrong user", async () => {
    const { sdk, calls, release } = fakeSdk({ holdLogIn: true });
    const identity = createIdentity(sdk);
    const identified = identity.identify("u1");
    let ensured = false;
    const ready = identity.ensure("u1").then(() => {
      ensured = true;
    });
    await Promise.resolve();
    assert.equal(ensured, false, "ensure must wait for the login");
    release();
    await Promise.all([identified, ready]);
    assert.equal(ensured, true);
    assert.deepEqual(calls, ["logIn:u1"]);
  });

  it("logs in when nobody has been identified yet", async () => {
    const { sdk, calls } = fakeSdk();
    await createIdentity(sdk).ensure("u1");
    assert.deepEqual(calls, ["logIn:u1"]);
  });

  it("logs in again when the SDK is on another user", async () => {
    const { sdk, calls, switchTo } = fakeSdk();
    const identity = createIdentity(sdk);
    await identity.identify("u1");
    switchTo("u2");
    await identity.ensure("u1");
    assert.deepEqual(calls, ["logIn:u1", "logIn:u1"]);
  });

  it("rejects when that login fails, so the purchase does not go ahead", async () => {
    const { sdk } = fakeSdk({ logInFails: true });
    await assert.rejects(createIdentity(sdk).ensure("u1"), /login failed/);
  });
});

describe("createIdentity.reset", () => {
  it("logs out a signed-in SDK user", async () => {
    const { sdk, calls } = fakeSdk();
    const identity = createIdentity(sdk);
    await identity.identify("u1");
    await identity.reset();
    assert.deepEqual(calls, ["logIn:u1", "logOut"]);
  });

  it("skips the logout of an anonymous user (the SDK rejects it)", async () => {
    const { sdk, calls } = fakeSdk();
    await createIdentity(sdk).reset();
    assert.deepEqual(calls, []);
  });

  it("never rejects, even when the logout fails", async () => {
    const { sdk } = fakeSdk({ logOutFails: true });
    const identity = createIdentity(sdk);
    await identity.identify("u1");
    await identity.reset();
  });

  it("forgets the user, so the next sign-in logs in again", async () => {
    const { sdk, calls } = fakeSdk();
    const identity = createIdentity(sdk);
    await identity.identify("u1");
    await identity.reset();
    await identity.identify("u1");
    assert.deepEqual(calls, ["logIn:u1", "logOut", "logIn:u1"]);
  });

  it("runs after a login in flight, never before it", async () => {
    const { sdk, calls, release } = fakeSdk({ holdLogIn: true });
    const identity = createIdentity(sdk);
    const identified = identity.identify("u1");
    const reset = identity.reset();
    await Promise.resolve();
    assert.deepEqual(calls, ["logIn:u1"], "logOut waits for the login");
    release();
    await Promise.all([identified, reset]);
    assert.deepEqual(calls, ["logIn:u1", "logOut"]);
  });
});
