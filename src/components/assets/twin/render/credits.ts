/** Credits for the equipment model files a render shows (wave 28). Pure. */
import { creditsShown } from "../../../../lib/assets/glb-file";
import type { TwinData } from "../types";

/** The model files drawn for one floor's registered devices: their URLs and the credit list (one line per model). */
export function floorModelFiles(data: Pick<TwinData, "assets" | "rooms" | "library">, floorId: number) {
  const rooms = new Set(data.rooms.filter((r) => r.floorId === floorId).map((r) => r.id));
  const entries = data.assets.filter((a) => a.roomId != null && rooms.has(a.roomId) && a.lib).map((a) => data.library?.[a.lib!]).filter((e) => !!e?.glb);
  return { urls: [...new Set(entries.map((e) => e!.glb!))], credits: creditsShown(entries.map((e) => ({ model: e!.model, glb: e!.glb, credit: e!.credit ?? null }))) };
}

export type Credit = { model: string; line: string; source: string | null };
/** Credits of several floors as one list, each once, in the same order as creditsShown. */
export function mergeCredits(lists: Credit[][]): Credit[] {
  const m = new Map<string, Credit>();
  for (const c of lists.flat()) m.set(`${c.model}|${c.line}|${c.source ?? ""}`, c);
  return [...m.values()].sort((a, b) => a.model.localeCompare(b.model) || a.line.localeCompare(b.line));
}

/** One line for the title block: "3D models: Model by A (CC BY 4.0); Model by B (CC0 1.0)". */
export function creditsLine(credits: { line: string }[], max = 3): string {
  if (!credits.length) return "";
  const lines = [...new Set(credits.map((c) => c.line))];
  return `3D models: ${lines.slice(0, max).join("; ")}${lines.length > max ? `; +${lines.length - max} more (see the list with the render)` : ""}`;
}
