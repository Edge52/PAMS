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

export type PanelId = "floors" | "view" | "status" | "find" | "types" | "layers" | "views" | "plan" | "place" | "routes" | "pathways" | "notes" | "tours" | "history" | "commissioning";
/** Wave 22: on a wide screen only these start open, one per side, so the model stays in view. */
const OPEN_BY_DEFAULT: PanelId[] = ["floors", "find"];
/** The two side columns. Opening a panel folds the others in its column (one open at a time per side). */
export const PANEL_COLUMNS: { left: PanelId[]; right: PanelId[] } = {
  left: ["floors", "layers", "plan", "commissioning", "view", "routes", "pathways", "history", "status"],
  right: ["place", "find", "notes", "tours", "views", "types"],
};
export type PanelPrefs = Partial<Record<string, boolean>>;

/** Preferences are remembered separately for compact and wide layouts, so a panel opened on a big screen still starts folded on a laptop. */
export const prefKey = (id: PanelId, mode: HudMode) => `${id}.${mode === "wide" ? "wide" : "compact"}`;

/** Open when the user opened it; with no choice yet, open only for the two default panels on a wide screen. */
export function isPanelOpen(prefs: PanelPrefs, id: PanelId, mode: HudMode): boolean {
  const v = prefs[prefKey(id, mode)];
  return v ?? (mode === "wide" && OPEN_BY_DEFAULT.includes(id));
}

/** The preferences after a click on a panel's header: it flips, and opening it folds the rest of its column. */
export function togglePanel(prefs: PanelPrefs, id: PanelId, mode: HudMode): PanelPrefs {
  const opening = !isPanelOpen(prefs, id, mode);
  const next: PanelPrefs = { ...prefs, [prefKey(id, mode)]: opening };
  if (opening) {
    const column = PANEL_COLUMNS.left.includes(id) ? PANEL_COLUMNS.left : PANEL_COLUMNS.right.includes(id) ? PANEL_COLUMNS.right : [];
    for (const other of column) if (other !== id) next[prefKey(other, mode)] = false;
  }
  return next;
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
