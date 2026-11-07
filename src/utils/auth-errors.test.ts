/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import { AuthApiError } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import en from "@/src/i18n/en";
import es from "@/src/i18n/es";
import { type SignUpErrorKey, signUpErrorKey } from "@/src/utils/auth-errors";

function lookup(dictionary: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dictionary);
}

describe("signUpErrorKey", () => {
  it("says the email already has an account, as Supabase answers it (422 user_already_exists)", () => {
    const error = new AuthApiError("User already registered", 422, "user_already_exists");
    assert.equal(signUpErrorKey(error), "auth.emailTaken");
  });

  it("knows the email_exists code and reads the message when the server sent no code", () => {
    assert.equal(
      signUpErrorKey(new AuthApiError("A user with this email address has already been registered", 422, "email_exists")),
      "auth.emailTaken",
    );
    assert.equal(signUpErrorKey(new Error("User already registered")), "auth.emailTaken");
    assert.equal(
      signUpErrorKey(new Error("A user with this email address has already been registered")),
      "auth.emailTaken",
    );
  });

  it("says registration is unavailable when sign-ups are switched off", () => {
    assert.equal(
      signUpErrorKey(new AuthApiError("Signups not allowed for this instance", 422, "signup_disabled")),
      "auth.signUpDisabled",
    );
    assert.equal(
      signUpErrorKey(new AuthApiError("Email signups are disabled", 422, "email_provider_disabled")),
      "auth.signUpDisabled",
    );
    assert.equal(signUpErrorKey(new Error("Signups not allowed for this instance")), "auth.signUpDisabled");
    assert.equal(signUpErrorKey(new Error("Email signups are disabled")), "auth.signUpDisabled");
  });

  it("keeps the generic message for anything else", () => {
    assert.equal(
      signUpErrorKey(new AuthApiError("Database error saving new user", 500, "unexpected_failure")),
      "common.somethingWentWrong",
    );
    assert.equal(
      signUpErrorKey(new AuthApiError("Password should be at least 6 characters.", 422, "weak_password")),
      "common.somethingWentWrong",
    );
    assert.equal(signUpErrorKey(new TypeError("Failed to fetch")), "common.somethingWentWrong");
    assert.equal(signUpErrorKey("User already registered"), "common.somethingWentWrong");
    assert.equal(signUpErrorKey(null), "common.somethingWentWrong");
    assert.equal(signUpErrorKey(undefined), "common.somethingWentWrong");
  });

  it("has copy in both languages for every message it can return", () => {
    const keys: SignUpErrorKey[] = ["auth.signUpDisabled", "auth.emailTaken", "common.somethingWentWrong"];
    for (const key of keys) {
      for (const [language, dictionary] of [["es", es], ["en", en]] as const) {
        assert.equal(typeof lookup(dictionary, key), "string", `${language} has no ${key}`);
      }
    }
  });
});
