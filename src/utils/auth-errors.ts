// Which message the sign-up screen shows for an error from
// supabase.auth.signUp. Supabase's Auth answers with a machine-readable `code`
// (HTTP 422 "User already registered" when "Confirm email" is off, "Signups
// not allowed for this instance" when sign-ups are switched off); older
// servers sent only the message, so that is matched as well.

export type SignUpErrorKey =
  | "auth.signUpDisabled"
  | "auth.emailTaken"
  | "common.somethingWentWrong";

const SIGN_UP_OFF_CODES = ["signup_disabled", "email_provider_disabled"];
const SIGN_UP_OFF_MESSAGE = /sign.?ups? (are )?not allowed|sign.?up.*disabled/i;

const EMAIL_TAKEN_CODES = ["user_already_exists", "email_exists"];
const EMAIL_TAKEN_MESSAGE = /already (been )?registered/i;

function readString(error: unknown, key: "code" | "message"): string {
  const value = (error as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "string" ? value : "";
}

export function signUpErrorKey(error: unknown): SignUpErrorKey {
  const code = readString(error, "code");
  const message = readString(error, "message");
  if (SIGN_UP_OFF_CODES.includes(code) || SIGN_UP_OFF_MESSAGE.test(message)) {
    return "auth.signUpDisabled";
  }
  if (EMAIL_TAKEN_CODES.includes(code) || EMAIL_TAKEN_MESSAGE.test(message)) {
    return "auth.emailTaken";
  }
  return "common.somethingWentWrong";
}
