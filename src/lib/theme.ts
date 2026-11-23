/**
 * Light or dark look (wave 38). The choice is kept per browser in a cookie, so the server paints the first page in the
 * right colours (no flash); "system" follows the device (prefers-color-scheme). Pure: used by the layout and the menu.
 */
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = "hpams_theme";
export const DEFAULT_THEME: Theme = "light";
export const THEME_LABELS: Record<Theme, string> = { light: "Light", dark: "Dark", system: "Same as my device" };

/** The theme in a cookie value; anything else (missing, old, tampered) is the default. */
export function parseTheme(value: string | null | undefined): Theme {
  const v = value?.trim().toLowerCase();
  return (THEMES as readonly string[]).includes(v ?? "") ? (v as Theme) : DEFAULT_THEME;
}

/** The theme cookie from a whole `Cookie` header (used in the browser, where only `document.cookie` is at hand). */
export function themeFromCookieHeader(header: string | null | undefined): Theme {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === THEME_COOKIE) return parseTheme(decodeURIComponent(part.slice(i + 1)));
  }
  return DEFAULT_THEME;
}

/** A year, so the choice outlives the sign-in session. */
export const THEME_MAX_AGE = 60 * 60 * 24 * 365;

/** The `document.cookie` string that remembers `theme` in this browser. */
export function themeCookieString(theme: Theme, secure = false): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
