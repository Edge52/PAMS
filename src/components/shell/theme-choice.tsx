"use client";
import { useState } from "react";
import { THEME_LABELS, THEMES, themeCookieString, type Theme } from "@/lib/theme";
import { setThemeAction } from "@/components/shell/theme-actions";
import { Icon } from "@/components/ui/icons";

/** Writes the cookie and switches the page's look at once. */
function applyTheme(t: Theme) {
  document.cookie = themeCookieString(t, location.protocol === "https:");
  document.documentElement.dataset.theme = t;
}

/**
 * Light, dark or the device's choice (wave 38), in the user menu. With JavaScript the look changes at once and the
 * cookie is written here; without it the form posts to `setThemeAction` and the page comes back in the new look.
 */
export function ThemeChoice({ theme }: { theme: Theme }) {
  const [now, setNow] = useState<Theme>(theme);
  function pick(e: React.MouseEvent<HTMLButtonElement>, t: Theme) {
    e.preventDefault();
    applyTheme(t);
    setNow(t);
  }
  return (
    <form action={setThemeAction} className="border-t border-line px-3 pb-2 pt-2">
      <p id="theme-label" className="mb-1.5 text-xs text-muted">Look</p>
      <div role="group" aria-labelledby="theme-label" className="grid gap-0.5">
        {THEMES.map((t) => (
          <button key={t} type="submit" name="theme" value={t} aria-pressed={now === t} onClick={(e) => pick(e, t)}
            className={`flex min-h-8 items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-sm hover:bg-sunken ${now === t ? "font-semibold text-primary-strong" : ""}`}>
            <span aria-hidden className={`grid size-4 place-items-center rounded-full border ${now === t ? "border-primary bg-primary text-on-primary" : "border-line"}`}>
              {now === t && <Icon name="check" size={10} />}
            </span>
            {THEME_LABELS[t]}
          </button>
        ))}
      </div>
    </form>
  );
}
