export type SdkStarterDeps = {
  /** The SDK key for this platform, or null when there is none to use. */
  key: string | null;
  /** Starts the SDK. May throw: a build without its native module does. */
  start(key: string): void;
  /** Hears about a start that threw. */
  onError?(error: unknown): void;
};

export type SdkStarter = {
  /**
   * Starts the SDK on the first call. True when it is up; false when it cannot
   * be: no key, or a start that threw (the error goes to `onError`, and the
   * start is not tried again). A build that cannot start the SDK loses
   * purchasing, not the app.
   */
  ensure(): boolean;
  /** Purchasing can work: there is a key and the start has not failed. */
  readonly available: boolean;
};

export function createSdkStarter(deps: SdkStarterDeps): SdkStarter {
  let state: "idle" | "up" | "failed" = "idle";
  return {
    ensure() {
      const { key } = deps;
      if (key == null || state === "failed") return false;
      if (state === "idle") {
        try {
          deps.start(key);
          state = "up";
        } catch (error) {
          state = "failed";
          deps.onError?.(error);
          return false;
        }
      }
      return true;
    },
    get available() {
      return deps.key != null && state !== "failed";
    },
  };
}
