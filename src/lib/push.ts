import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { pushPlatform } from "@/src/utils/push";
import { supabase } from "@/src/utils/supabase";

/**
 * The coach's push notifications: the device half. The database sends them
 * (the program, nutrition plan and supplement plan triggers, through Expo's
 * push service) to every token in `push_tokens` for the client; this keeps
 * this phone's token there while a client is signed in (`usePushToken`) and
 * takes it out on sign-out.
 *
 * Showing them in the foreground and opening their tab on tap is the local
 * reminders' wiring (`@/src/lib/rest-alert`, `useReminderTaps`); what they
 * carry is in `@/src/utils/push`.
 *
 * Fails soft: no permission, no network, Expo Go (no push token on Android)
 * or a refused write never throw into the screens. No-ops on web.
 */

/** The Android channel the database's pushes name (`channelId`). */
export const PUSH_CHANNEL_ID = "coach";

/** The token this phone last registered, kept for sign-out: by then the
    session may be a cold start that never registered. */
const TOKEN_KEY = "push_token";
/** How long sign-out waits to take the token out before signing out anyway. */
const UNREGISTER_WAIT_MS = 3000;

const isWeb = Platform.OS === "web";

/**
 * Create the Android channel, or rename it (see `ensureReminderChannel`:
 * Android keeps everything but the name). Default importance, like the
 * reminders: news, not an alarm.
 */
export async function ensurePushChannel(name: string): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
      name,
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch {}
}

/**
 * Register and unregister run one at a time, so a sign-out lands after a
 * registration in flight and can't leave the row behind.
 */
let queue: Promise<void> = Promise.resolve();

function serialized(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task).catch(() => {});
  return queue;
}

/** Registered this app session: the token and whose row it is. */
let registered: { userId: string; token: string } | null = null;

async function register(userId: string): Promise<void> {
  const platform = pushPlatform(Platform.OS);
  if (platform == null) return;
  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  if (registered?.userId === userId && registered.token === token) return;
  // Also moves the row off another account that last used this phone.
  const { error } = await supabase.rpc("register_push_token", {
    p_token: token,
    p_platform: platform,
  });
  if (error) return;
  registered = { userId, token };
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

async function unregister(): Promise<void> {
  const token = registered?.token ?? (await AsyncStorage.getItem(TOKEN_KEY));
  registered = null;
  if (token == null) return;
  // RLS: only the signed-in user's own row. Offline, the row stays until the
  // next sign-in on this phone moves it.
  await supabase.from("push_tokens").delete().eq("token", token);
  await AsyncStorage.removeItem(TOKEN_KEY);
}

/** Put this phone's token on `userId`'s row. Once per app session unless the
    token changes. Needs notification permission (the caller checks). */
export function registerPushToken(userId: string): Promise<void> {
  if (isWeb) return Promise.resolve();
  return serialized(() => register(userId));
}

/**
 * Take this phone's token out of `push_tokens` (sign-out, permission gone),
 * while the session still allows it. Resolves within UNREGISTER_WAIT_MS even
 * offline, so a sign-out never waits on it longer.
 */
export function unregisterPushToken(): Promise<void> {
  if (isWeb) return Promise.resolve();
  const done = serialized(unregister);
  return Promise.race([
    done,
    new Promise<void>((resolve) => setTimeout(resolve, UNREGISTER_WAIT_MS)),
  ]);
}
