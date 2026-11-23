"use server";
import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE, THEME_MAX_AGE } from "@/lib/theme";

/**
 * Remember the look in this browser (wave 38). Used when the page runs without JavaScript; with it, the menu sets the
 * same cookie itself and changes the look at once. Not a secret and not tied to the account, so no permission check.
 */
export async function setThemeAction(fd: FormData): Promise<void> {
  const theme = parseTheme(String(fd.get("theme") ?? ""));
  const secure = process.env.COOKIE_SECURE === "1" || (process.env.COOKIE_SECURE !== "0" && (process.env.APP_URL ?? "").startsWith("https://"));
  (await cookies()).set(THEME_COOKIE, theme, { path: "/", maxAge: THEME_MAX_AGE, sameSite: "lax", secure });
}
