/**
 * Layout rules for the 3D view's HUD (pure, unit-tested).
 * - phone   (< 640 px):  one bottom sheet with tabs instead of side columns
 * - compact (< 1100 px): side columns, panels start collapsed to their headers
 * - wide:                side columns, panels start open
 * The width is the 3D view's own width (it may sit in a narrow pane), not the window's.
 */
export type HudMode = "phone" | "compact" | "wide";

export const PHONE_MAX = 640;
export const COMPACT_MAX = 1100;

export function hudMode(width: number): HudMode {
  if (width < PHONE_MAX) return "phone";
  if (width < COMPACT_MAX) return "compact";
  return "wide";
}

export type PanelId = "floors" | "view" | "status" | "find" | "types" | "layers" | "views" | "plan" | "place" | "routes" | "pathways";
/** Panels that start folded even on a wide screen (opened when needed). */
const FOLDED_BY_DEFAULT: PanelId[] = ["plan", "routes", "pathways"];
export type PanelPrefs = Partial<Record<string, boolean>>;

/** Preferences are remembered separately for compact and wide layouts, so a panel opened on a big screen still starts folded on a laptop. */
export const prefKey = (id: PanelId, mode: HudMode) => `${id}.${mode === "wide" ? "wide" : "compact"}`;

/** Open unless the user closed it; in compact mode closed unless the user opened it. */
export function isPanelOpen(prefs: PanelPrefs, id: PanelId, mode: HudMode): boolean {
  const v = prefs[prefKey(id, mode)];
  return v ?? (mode === "wide" && !FOLDED_BY_DEFAULT.includes(id));
}

/** Parse the stored JSON, ignoring anything that isn't `{ [key]: boolean }`. */
export function parsePrefs(raw: string | null | undefined): PanelPrefs {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, b]) => typeof b === "boolean")) as PanelPrefs;
  } catch {
    return {};
  }
}

export type SheetTab = "floors" | "filters" | "find" | "details";

/** The phone sheet's visible tab: the details tab only exists while something is selected. */
export function visibleSheetTab(tab: SheetTab | null, hasSelection: boolean): SheetTab | null {
  return tab === "details" && !hasSelection ? null : tab;
}
