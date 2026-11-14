import { routeGuard } from "@/lib/auth/route-guard";
import { facilityScope, getCurrentUser } from "@/lib/auth/session";
import { facilityOfFloor, inScope } from "@/lib/assets/access";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { floorCad } from "@/db/schema";

export const dynamic = "force-dynamic";

/** CAD linework for one floor of the 3D view (walls, doors, glazing, columns in plan units). */
export async function GET(req: Request, { params }: { params: Promise<{ floorId: string }> }) {
  const denied = await routeGuard("assets.view");
  if (denied) return denied;
  const id = Number((await params).floorId);
  if (!Number.isInteger(id) || id <= 0) return new Response("Not found", { status: 404 });
  const facilityId = await facilityOfFloor(id);
  if (facilityId == null) return new Response("Not found", { status: 404 });
  if (!inScope(await facilityScope(await getCurrentUser()), facilityId)) return new Response("You don't have access to this facility.", { status: 403 });
  const [g] = await db.select({ walls: floorCad.walls, doors: floorCad.doors, glass: floorCad.glass, columns: floorCad.columns })
    .from(floorCad).where(eq(floorCad.floorId, id));
  if (!g) return new Response("Not found", { status: 404 });
  // Wave 22: the linework is big (hundreds of KB a floor). The browser keeps it and asks "still the same?" each time;
  // an unchanged floor answers 304 with no body.
  const body = JSON.stringify({ walls: g.walls ?? [], doors: g.doors ?? [], glass: g.glass ?? [], columns: g.columns ?? [] });
  const etag = `"${createHash("sha1").update(body).digest("base64url")}"`;
  const headers = { "Cache-Control": "private, no-cache", ETag: etag, Vary: "Accept-Encoding" };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  // Sent compressed (long lists of numbers shrink to about a quarter); route responses aren't compressed for us.
  if (/\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")) {
    return new Response(new Uint8Array(gzipSync(body)), { headers: { ...headers, "Content-Type": "application/json", "Content-Encoding": "gzip" } });
  }
  return new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
}
