import { Linking, Platform } from "react-native";
import Purchases, {
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  type PurchasesPackage,
} from "react-native-purchases";

import { ENTITLEMENT_ID, resolveSdkKey, SDK_KEYS, type PlanKind } from "@/src/config/purchases";
import type { PurchasesGateway } from "@/src/lib/purchases-gateway";
import { createIdentity } from "@/src/lib/purchases-identity";
import { createSdkStarter } from "@/src/lib/sdk-starter";
import { classifyPurchaseError, pickPlans, PurchaseFailed } from "@/src/utils/purchase";

// The RevenueCat SDK on iOS and Android (src/lib/purchases-gateway.ts says
// what it is for). Metro picks src/lib/purchases.web.ts on web, so this file,
// and the SDK with it, never reach the web bundle. Nothing here has run on a
// device yet: it type-checks, and the pure rules around it are tested
// (src/utils/purchase.ts, src/lib/purchases-identity.ts, src/lib/sdk-starter.ts).

/** The SDK key for this platform, or null: web, no variable set, or a Test
    Store key in a release build (RevenueCat crashes those on purpose). */
const apiKey = resolveSdkKey(Platform.OS, SDK_KEYS, __DEV__);

/** Where Google Play lists a user's subscriptions, when the customer has no
    management URL of their own. */
const PLAY_SUBSCRIPTIONS_URL = "https://play.google.com/store/account/subscriptions";

const sdk = createSdkStarter({
  key: apiKey,
  start(key) {
    // No appUserID: the user is logged in once the session starts (identify).
    Purchases.configure({ apiKey: key });
    void Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN).catch(() => {});
  },
  onError(error) {
    // A build without the SDK's native module (a development client made before
    // it was added) lands here: no purchasing, but the app opens.
    console.warn("[purchases] the SDK did not start, so purchasing is off in this build.", error);
  },
});

function configure(): boolean {
  return sdk.ensure();
}

const identity = createIdentity(Purchases);

/** The SDK packages of the last loaded offering, by plan kind: what `purchase`
    buys. */
const packages = new Map<PlanKind, PurchasesPackage>();

function fail(error: unknown): never {
  throw new PurchaseFailed(classifyPurchaseError(error, PURCHASES_ERROR_CODE));
}

export const purchases: PurchasesGateway = {
  get available() {
    return sdk.available;
  },

  configure() {
    configure();
  },

  identify(userId) {
    return configure() ? identity.identify(userId) : Promise.resolve();
  },

  reset() {
    return configure() ? identity.reset() : Promise.resolve();
  },

  async loadPlans() {
    if (!configure()) return [];
    try {
      const offerings = await Purchases.getOfferings();
      const available = offerings.current?.availablePackages ?? [];
      const plans = pickPlans(available);
      packages.clear();
      for (const plan of plans) {
        const found = available.find((p) => p.identifier === plan.identifier);
        if (found != null) packages.set(plan.kind, found);
      }
      return plans;
    } catch (error) {
      return fail(error);
    }
  },

  async purchase(kind, userId) {
    const target = packages.get(kind);
    if (!configure() || target == null) throw new PurchaseFailed({ kind: "store_problem", detail: null });
    try {
      // The purchase must land on this user, not on an anonymous id.
      await identity.ensure(userId);
      await Purchases.purchasePackage(target);
    } catch (error) {
      return fail(error);
    }
  },

  async restore(userId) {
    if (!configure()) return { found: false };
    try {
      await identity.ensure(userId);
      const info = await Purchases.restorePurchases();
      return { found: info.entitlements.active[ENTITLEMENT_ID] != null };
    } catch (error) {
      return fail(error);
    }
  },

  async manage() {
    if (!configure()) return "unavailable";
    try {
      if (Platform.OS === "ios") {
        await Purchases.showManageSubscriptions();
      } else {
        const info = await Purchases.getCustomerInfo();
        await Linking.openURL(info.managementURL ?? PLAY_SUBSCRIPTIONS_URL);
      }
      return "opened";
    } catch {
      return "unavailable";
    }
  },

  onCustomerInfoChange(listener) {
    if (!configure()) return () => {};
    // The SDK passes the customer; the app only needs to know it changed.
    const onChange = () => listener();
    Purchases.addCustomerInfoUpdateListener(onChange);
    return () => {
      Purchases.removeCustomerInfoUpdateListener(onChange);
    };
  },
};
