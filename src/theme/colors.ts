import { useThemeScheme } from "./theme-store";

/**
 * Raw color constants mirroring the CSS tokens in src/global.css.
 * Only for places className can't reach: navigation options,
 * placeholderTextColor, ActivityIndicator/Ionicons/RefreshControl colors.
 * Keep in sync with global.css (:root light block + dark media block).
 *
 * Scheme-aware: components read the palette via useColors(), which follows
 * the effective scheme (RN Appearance, plus the web override — see
 * theme-store.ts). There
 * is deliberately no static `colors` export — every consumer must go
 * through the hook so no site can silently stay light-only.
 *
 * Token names kept from the dark era — brandDark is the CANVAS color,
 * brandLight the INK color, in both schemes.
 */
const lightPalette = {
    white: "#ffffff",
    brandPrimary: "#dc2626",
    brandPrimaryDark: "#b91c1c",
    brandSecondary: "#2563eb",
    brandAccent: "#a16207",
    brandDark: "#f8fafc",
    brandLight: "#0f172a",
    surface: "#ffffff",
    surfaceElevated: "#f1f5f9",
    contentPrimary: "#0f172a",
    contentSecondary: "#334155",
    contentTertiary: "#64748b",
    contentMuted: "#94a3b8",
    border: "#e2e8f0",
    borderStrong: "#cbd5e1",
    // Web-only: page background behind the centered app column
    // (app/_layout.tsx). TS-only token — no className counterpart needed.
    webGutter: "#e2e8f0",
    success: "#16a34a",
    error: "#dc2626",
    warning: "#d97706",
    info: "#2563eb",
    infoSoft: "rgba(37, 99, 235, 0.1)",
    superset: "#7c3aed",
    supersetSoft: "rgba(124, 58, 237, 0.08)",
    macroProtein: "#2563eb",
    macroCarbs: "#d97706",
    macroFat: "#e11d48",
    // Dojo Poster tokens (mirror global.css)
    brandPrimarySoft: "rgba(220, 38, 38, 0.08)",
    brandAccentSoft: "rgba(161, 98, 7, 0.12)",
    brandAccentBorder: "rgba(161, 98, 7, 0.35)",
    successSoft: "rgba(22, 163, 74, 0.12)",
    skewGhost: "rgba(220, 38, 38, 0.05)",
    headerGradFrom: "#ffffff",
    headerGradTo: "#f8fafc",
};

export type Palette = { [K in keyof typeof lightPalette]: string };
export type PaletteColor = keyof Palette;

const darkPalette: Palette = {
    white: "#ffffff",
    brandPrimary: "#ef4444",
    brandPrimaryDark: "#dc2626",
    brandSecondary: "#3b82f6",
    brandAccent: "#fbbf24",
    brandDark: "#0f172a",
    brandLight: "#f8fafc",
    surface: "#1e293b",
    surfaceElevated: "#334155",
    contentPrimary: "#f8fafc",
    contentSecondary: "#cbd5e1",
    contentTertiary: "#94a3b8",
    contentMuted: "#64748b",
    border: "#334155",
    borderStrong: "#475569",
    // Darker than the canvas so the app column pops on dark web
    webGutter: "#020617",
    success: "#22c55e",
    error: "#ef4444",
    warning: "#f59e0b",
    info: "#3b82f6",
    infoSoft: "rgba(59, 130, 246, 0.16)",
    superset: "#a78bfa",
    supersetSoft: "rgba(167, 139, 250, 0.12)",
    macroProtein: "#3b82f6",
    macroCarbs: "#f59e0b",
    macroFat: "#fb7185",
    brandPrimarySoft: "rgba(239, 68, 68, 0.1)",
    brandAccentSoft: "rgba(251, 191, 36, 0.16)",
    brandAccentBorder: "rgba(251, 191, 36, 0.35)",
    successSoft: "rgba(34, 197, 94, 0.15)",
    skewGhost: "rgba(220, 38, 38, 0.08)",
    headerGradFrom: "#1e293b",
    headerGradTo: "#0f172a",
};

export const palettes: { light: Palette; dark: Palette } = {
  light: lightPalette,
  dark: darkPalette,
};

export function useColors(): Palette {
  // useThemeScheme (not RN useColorScheme): on web an explicit toggle can't
  // reach Appearance, so the effective scheme lives in the theme store.
  const scheme = useThemeScheme();
  return palettes[scheme];
}
