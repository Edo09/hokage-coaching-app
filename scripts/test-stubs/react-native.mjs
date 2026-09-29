// Stand-in for "react-native" under `npm test` (see ../test-resolve.mjs).
// Covers only what modules under test touch; the real one never runs in Node.
export const AppState = {
  currentState: "active",
  addEventListener: () => ({ remove() {} }),
};
