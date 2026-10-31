import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, documents, floors } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { facilityScope, getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { canViewDocumentsOf } from "@/lib/documents-access";
import { fileKind, resolveStored } from "@/lib/storage";

/**
 * A file is served only to someone who may see the record it belongs to: attachments need that module's read
 * permission and the record's facility; floor plans need assets access to that floor's facility. Anything we
 * have no record of is "not found" (also for files whose record was deleted).
 */
async function mayRead(me: CurrentUser, segments: string[], url: string): Promise<boolean> {
  if (segments[0] === "plans") {
    if (!can(me.role, "assets.view")) return false;
    const [f] = await db.select({ facilityId: buildings.facilityId }).from(floors)
      .innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(floors.planImageUrl, url)).limit(1);
    if (!f) return false;
    const scope = await facilityScope(me);
    return scope === null || scope.includes(f.facilityId);
  }
  const [entityType, idText] = segments;
  const entityId = Number(idText);
  if (!Number.isInteger(entityId) || entityId <= 0) return false;
  const [doc] = await db.select({ id: documents.id }).from(documents)
    .where(and(eq(documents.entityType, entityType), eq(documents.entityId, entityId), eq(documents.url, url))).limit(1);
  return !!doc && (await canViewDocumentsOf(me, entityType, entityId));
}

export const dynamic = "force-dynamic";

/** Serves uploaded files safely. See src/lib/storage.ts for the rules. */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const me = await getCurrentUser();
  if (!me) return new Response("Sign in first.", { status: 401 });
  const { path: segments } = await params;
  const decoded = segments.map((s) => decodeURIComponent(s));
  // Stored URLs encode only the file name (see storeFile), so rebuild that form to match the record.
  const url = `/files/${decoded.slice(0, -1).join("/")}/${encodeURIComponent(decoded.at(-1) ?? "")}`;
  if (!(await mayRead(me, decoded, url))) return new Response("Not found", { status: 404 });
  const abs = resolveStored(decoded);
  const kind = abs ? fileKind(abs) : null;
  if (!abs || !kind) return new Response("Not found", { status: 404 });

  try {
    const info = await stat(abs);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    const body = await readFile(abs);
    // Show the original name, without our timestamp prefix.
    const display = path.basename(abs).replace(/^\d+-/, "");
    const headers = new Headers({
      "Content-Type": kind.mime,
      "Content-Length": String(info.size),
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${kind.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(display)}`,
      "Cache-Control": "private, max-age=3600",
      "Referrer-Policy": "no-referrer",
    });
    // Sandbox everything except PDFs (Chrome's PDF viewer refuses to render in a sandboxed document).
    if (kind.mime !== "application/pdf") headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    return new Response(new Uint8Array(body), { status: 200, headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
