import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, parseTheme, themeCookieString, themeFromCookieHeader, THEME_COOKIE } from "./theme";

describe("theme cookie (wave 38)", () => {
  it("reads the three choices and falls back to light", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme(" System ")).toBe("system");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme(undefined)).toBe(DEFAULT_THEME);
    expect(parseTheme("")).toBe("light");
    expect(parseTheme("purple")).toBe("light");
    expect(parseTheme("dark; Path=/")).toBe("light");
  });
  it("finds the theme in a whole cookie header", () => {
    expect(themeFromCookieHeader(`hpams_session=abc; ${THEME_COOKIE}=dark; other=1`)).toBe("dark");
    expect(themeFromCookieHeader(`x${THEME_COOKIE}=dark`)).toBe("light");
    expect(themeFromCookieHeader(null)).toBe("light");
  });
  it("writes a long-lived cookie for the whole site", () => {
    const c = themeCookieString("system");
    expect(c).toMatch(/^hpams_theme=system; Path=\/; Max-Age=\d+; SameSite=Lax$/);
    expect(themeCookieString("dark", true)).toContain("; Secure");
  });
});
