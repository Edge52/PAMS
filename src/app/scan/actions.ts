"use server";
/** Scan a label (wave 26): turn what the camera or a scanner read into the device's page. */
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { findLabel } from "@/lib/assets/label-server";
import { parseScan } from "@/lib/assets/rounds";

export async function findScanned(raw: string): Promise<{ href: string } | { error: string }> {
  const me = await requirePermission("assets.view");
  const s = parseScan(raw);
  if (!s) return { error: `“${raw.slice(0, 60)}” isn't a device label. Try again, or type the tag.` };
  const scope = await facilityScope(me);
  // The tag wins over the id an old label carries (audit B4); the asset page says when the tag no longer matches.
  const a = await findLabel(s, scope);
  if (!a) return { error: `No device ${s.tag ?? `#${s.assetId}`} in the register${scope !== null ? " for your hospitals" : ""}.` };
  return { href: a.tagChanged && s.tag ? `/assets/${a.id}?tag=${encodeURIComponent(s.tag)}` : `/assets/${a.id}` };
}
