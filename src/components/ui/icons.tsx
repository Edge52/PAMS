/**
 * The app's small icon set (wave 21): thin-line, 24 px grid, drawn with the current text colour.
 * Server-safe. Decorative by default; pass `label` when the icon stands alone and must be read out.
 */
import type { ReactNode } from "react";

const PATHS = {
  planning: <path d="M4 5h16M4 12h10M4 19h7" />,
  procurement: <><path d="M6 7h12l-1 12H7z" /><path d="M9 7a3 3 0 0 1 6 0" /></>,
  finance: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></>,
  assets: <><rect x="4" y="4" width="16" height="12" rx="2" /><path d="M9 20h6M12 16v4" /></>,
  maintenance: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>,
  buildings: <><path d="M4 20V8l8-4 8 4v12" /><path d="M9 20v-6h6v6" /></>,
  pathways: <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 6h6a4 4 0 0 1 0 8h-4a4 4 0 0 0 0 8" /></>,
  reports: <path d="M5 20V10M12 20V4M19 20v-7" />,
  admin: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  home: <><path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  chevronDown: <path d="M5 9l7 7 7-7" />,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.8z" />,
  bookmark: <path d="M7 4h10v16l-5-4-5 4z" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  alert: <><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></>,
  inbox: <><path d="M4 13l2.5-8h11L20 13v6H4z" /><path d="M4 13h5a3 3 0 0 0 6 0h5" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function Icon({ name, size = 18, label, className }: { name: IconName; size?: number; label?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {PATHS[name]}
    </svg>
  );
}
