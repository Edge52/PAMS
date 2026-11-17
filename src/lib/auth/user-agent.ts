/**
 * A short name for the browser a session was started from (wave 27): "Chrome on Windows". Pure.
 * Only this label is stored with a session, not the whole user-agent string.
 */
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, "Edge"], [/OPR\/|Opera/, "Opera"], [/SamsungBrowser\//, "Samsung Internet"], [/Firefox\/|FxiOS\//, "Firefox"],
  [/CriOS\/|Chrome\/|Chromium\//, "Chrome"], [/Safari\//, "Safari"],
];
const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPod/, "iPhone"], [/iPad/, "iPad"], [/Android/, "Android"], [/Windows/, "Windows"], [/CrOS/, "ChromeOS"],
  [/Mac OS X|Macintosh/, "Mac"], [/Linux/, "Linux"],
];

export function browserLabel(ua: string | null | undefined): string | null {
  const s = (ua ?? "").trim();
  if (!s) return null;
  if (!/[/(]/.test(s)) return s.slice(0, 60); // already a label (sessions from wave 27 on)
  const browser = BROWSERS.find(([re]) => re.test(s))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(s))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "Unknown browser";
}
