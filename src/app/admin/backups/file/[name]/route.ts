import { promises as fs } from "node:fs";
import path from "node:path";
import { routeGuard } from "@/lib/auth/route-guard";
import { BACKUP_DIR, SAFE_NAME } from "@/lib/backups";

export const dynamic = "force-dynamic";

/** Download one backup file (administrators only). */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const denied = await routeGuard("users.manage"); if (denied) return denied;
  const { name } = await params;
  if (!SAFE_NAME.test(name)) return new Response("Not a backup file.", { status: 400 });
  const data = await fs.readFile(path.join(/* turbopackIgnore: true */ BACKUP_DIR, name)).catch(() => null);
  if (!data) return new Response("That backup file isn't there.", { status: 404 });
  const type = name.endsWith(".zip") ? "application/zip" : name.endsWith(".gz") || name.endsWith(".tgz") ? "application/gzip" : "application/octet-stream";
  return new Response(new Uint8Array(data), { headers: { "content-type": type, "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
}
