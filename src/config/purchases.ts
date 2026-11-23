// RevenueCat configuration, in one place (docs/superpowers/specs/
// 2026-11-16-premium-subscriptions-design.md, «The app»). No React Native and
// no SDK import: `npm test` loads this file, and the web bundle can too.

/** The one entitlement every Premium product grants (set up in RevenueCat). */
export const ENTITLEMENT_ID = "premium_access";

/** The plans the paywall offers, in display order. */
export const PLAN_KINDS = ["monthly", "quarterly", "annual"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

/**
 * The offering is matched by package type, never by product id: the SDK's
 * PACKAGE_TYPE of the packages RevenueCat names $rc_monthly, $rc_three_month
 * and $rc_annual. src/config/purchases.test.ts checks these against the SDK's
 * own enum, so an upgrade that renames one fails the tests.
 */
export const PLAN_PACKAGE_TYPES: Record<PlanKind, "MONTHLY" | "THREE_MONTH" | "ANNUAL"> = {
  monthly: "MONTHLY",
  quarterly: "THREE_MONTH",
  annual: "ANNUAL",
};

/**
 * The public SDK keys, one per store, set as EAS variables per environment
 * (like the Supabase ones). Written as literal `process.env.EXPO_PUBLIC_…`
 * reads: that is the only form Expo inlines into the bundle.
 */
export const SDK_KEYS: { ios?: string; android?: string } = {
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
};

/**
 * The key to configure the SDK with on this platform, or null when there is
 * none to use: web (no purchases there), a missing or blank variable, or a
 * Test Store key (`test_…`) outside a dev client. RevenueCat makes a release
 * build crash on purpose when it is configured with a Test Store key, so a
 * key set in the wrong EAS environment turns purchases off instead of taking
 * the whole app down.
 */
export function resolveSdkKey(
  os: string,
  keys: { ios?: string; android?: string },
  dev: boolean,
): string | null {
  const raw = os === "ios" ? keys.ios : os === "android" ? keys.android : undefined;
  const key = raw?.trim();
  if (key == null || key === "") return null;
  if (key.startsWith("test_") && !dev) return null;
  return key;
}

/** The public privacy-policy page (the panel serves /privacidad.html). */
export const PRIVACY_POLICY_URL: string | null =
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL?.trim() || null;

/** The coach's own Terms of Use page, when they have one. */
export const TERMS_URL_ENV: string | undefined = process.env.EXPO_PUBLIC_TERMS_OF_USE_URL;

/** Apple's standard EULA: acceptable as the Terms of Use of an iOS app. */
export const APPLE_STANDARD_EULA_URL =
  "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

/**
 * The Terms of Use link of the paywall: the coach's page when configured,
 * else Apple's standard EULA on iOS, else none (Google has no standard one).
 */
export function termsUrl(os: string, configured: string | undefined): string | null {
  const url = configured?.trim();
  if (url != null && url !== "") return url;
  return os === "ios" ? APPLE_STANDARD_EULA_URL : null;
}
