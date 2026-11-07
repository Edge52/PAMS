import { routeGuard } from "@/lib/auth/route-guard";
import { facilityScope, getCurrentUser } from "@/lib/auth/session";
import { inScope } from "@/lib/assets/access";
import { facilityClashes } from "@/lib/assets/clash-server";
import { checkedRooms, loadStandards } from "@/lib/assets/room-standards-server";
import { hospitalSimModel } from "@/lib/flows/simulate-server";

export const dynamic = "force-dynamic";

/**
 * Checks for the 3D view, loaded only when one is switched on (wave 19): `what=clashes` (clash and clearance check),
 * `templates` (each room against its room template) or `sim` (the queue simulation model).
 */
export async function GET(req: Request) {
  const denied = await routeGuard("assets.view");
  if (denied) return denied;
  const me = await getCurrentUser();
  const sp = new URL(req.url).searchParams;
  const facilityId = Number(sp.get("facilityId")), what = sp.get("what");
  if (!me || !Number.isInteger(facilityId) || facilityId <= 0) return new Response("Choose a hospital.", { status: 400 });
  if (!inScope(await facilityScope(me), facilityId)) return new Response("You don't have access to this facility.", { status: 403 });
  const json = (v: unknown) => Response.json(v, { headers: { "Cache-Control": "no-store" } });
  if (what === "clashes") return json((await facilityClashes(facilityId)).floors.flatMap((f) => f.issues));
  if (what === "sim") return json((await hospitalSimModel(facilityId)).model);
  if (what === "templates") {
    const rows = (await checkedRooms(facilityId, (await loadStandards()).rules)).filter((c) => c.standardIndex != null && c.state !== "none");
    return json(rows.map((c) => [c.id, {
      label: c.standard ?? "", index: c.standardIndex!, state: c.state,
      short: c.rows.filter((x) => x.state === "short" && x.kind !== "equipment").map((x) => `${x.label}: ${x.have} (${x.need})`),
      missing: c.rows.filter((x) => x.state === "short" && x.kind === "equipment").map((x) => `${x.label}: ${x.have} of ${x.need.replace("≥ ", "")}`),
      unknown: c.rows.filter((x) => x.state === "unknown").map((x) => x.label),
    }]));
  }
  return new Response("Ask for clashes, templates or sim.", { status: 400 });
}
