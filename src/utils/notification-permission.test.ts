/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type PermissionRead,
  readPermissionStatus,
  requestPermissionStatus,
  toPermissionStatus,
} from "@/src/utils/notification-permission";

// What getPermissionsAsync reports on each phone state (granted, canAskAgain,
// and on iOS the authorization status: 0 not asked, 1 denied, 2 authorized,
// 3 provisional).
const ANDROID_12_DEFAULT: PermissionRead = { granted: true, canAskAgain: true };
const ANDROID_13_NOT_ASKED: PermissionRead = { granted: false, canAskAgain: true };
const ANDROID_13_ONE_NO: PermissionRead = { granted: false, canAskAgain: true };
const ANDROID_13_TWO_NOS: PermissionRead = { granted: false, canAskAgain: false };
const IOS_NOT_ASKED: PermissionRead = { granted: false, canAskAgain: true, ios: { status: 0 } };
const IOS_DENIED: PermissionRead = { granted: false, canAskAgain: false, ios: { status: 1 } };
const IOS_ALLOWED: PermissionRead = { granted: true, canAskAgain: true, ios: { status: 2 } };
const IOS_PROVISIONAL_READ: PermissionRead = {
  granted: false,
  canAskAgain: true,
  ios: { status: 3 },
};

const fails = () => Promise.reject(new Error("unavailable"));

describe("toPermissionStatus", () => {
  it("granted: allowed, Android 12 and older by default, or iOS provisional", () => {
    assert.equal(toPermissionStatus(ANDROID_12_DEFAULT), "granted");
    assert.equal(toPermissionStatus(IOS_ALLOWED), "granted");
    assert.equal(toPermissionStatus(IOS_PROVISIONAL_READ), "granted");
  });

  it("undetermined while the phone can still prompt, even after a first no", () => {
    assert.equal(toPermissionStatus(ANDROID_13_NOT_ASKED), "undetermined");
    assert.equal(toPermissionStatus(ANDROID_13_ONE_NO), "undetermined");
    assert.equal(toPermissionStatus(IOS_NOT_ASKED), "undetermined");
  });

  it("denied once only the phone's settings can turn it on", () => {
    assert.equal(toPermissionStatus(ANDROID_13_TWO_NOS), "denied");
    assert.equal(toPermissionStatus(IOS_DENIED), "denied");
  });
});

describe("readPermissionStatus", () => {
  it("maps what the phone reports", async () => {
    assert.equal(await readPermissionStatus(async () => IOS_PROVISIONAL_READ), "granted");
    assert.equal(await readPermissionStatus(async () => ANDROID_13_ONE_NO), "undetermined");
  });

  it("a read that throws counts as denied", async () => {
    assert.equal(await readPermissionStatus(fails), "denied");
  });
});

describe("requestPermissionStatus", () => {
  it("never prompts when already granted or denied", async () => {
    let prompts = 0;
    const request = async () => {
      prompts++;
      return IOS_ALLOWED;
    };
    assert.equal(await requestPermissionStatus(async () => ANDROID_12_DEFAULT, request), "granted");
    assert.equal(await requestPermissionStatus(async () => IOS_DENIED, request), "denied");
    assert.equal(prompts, 0);
  });

  it("prompts while it still can, and returns the answer", async () => {
    let prompts = 0;
    const allow = async () => {
      prompts++;
      return IOS_ALLOWED;
    };
    const refuse = async () => {
      prompts++;
      return ANDROID_13_ONE_NO;
    };
    assert.equal(await requestPermissionStatus(async () => IOS_NOT_ASKED, allow), "granted");
    assert.equal(await requestPermissionStatus(async () => ANDROID_13_NOT_ASKED, refuse), "undetermined");
    assert.equal(prompts, 2);
  });

  it("a read or a prompt that throws counts as denied", async () => {
    assert.equal(await requestPermissionStatus(fails, async () => IOS_ALLOWED), "denied");
    assert.equal(await requestPermissionStatus(async () => IOS_NOT_ASKED, fails), "denied");
  });
});
