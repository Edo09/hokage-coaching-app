const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Transform workers as child processes, not worker threads (Expo's default).
// The workers load NativeWind's native CSS addons, and on Linux the process
// segfaults while tearing those threads down after the bundle is written —
// every EAS Android release build died in "Bundle JavaScript" (exit 139).
config.transformer.unstable_workerThreads = false;

module.exports = withNativewind(config, {
  // inline variables break PlatformColor in CSS variables
  inlineVariables: false,
  // Global className support required by gluestack-ui components
  // (components/ui/*), which style RN primitives via className.
  // The src/tw wrapper keeps working alongside it.
  globalClassNamePolyfill: true,
});
