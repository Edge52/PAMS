import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { deviceTypes, facilities, suppliers } from "@/db/schema";
import { ROLE_LABELS, ROLES } from "@/lib/auth/permissions";
import { routeGuard } from "@/lib/auth/route-guard";
import { IMPORT_KINDS, KIND_INFO, type ImportKind } from "@/lib/imports/kinds";
import { templateResponse } from "@/lib/imports/read-server";

export const dynamic = "force-dynamic";

/** Downloadable template for one import kind (wave 41), with lists of valid values where they help. */
export async function GET(_: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind: k } = await params;
  if (!(IMPORT_KINDS as readonly string[]).includes(k)) return new Response("Unknown import.", { status: 404 });
  const kind = k as ImportKind, info = KIND_INFO[kind];
  const denied = await routeGuard(info.perm);
  if (denied) return denied;
  const lists: { name: string; header: string[]; rows: (string | number | null)[][] }[] = [];
  if (kind === "contracts" || kind === "ppm" || kind === "parts") {
    const s = await db.select({ name: suppliers.name, country: suppliers.country }).from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.name)).limit(5000);
    lists.push({ name: "Suppliers", header: ["Supplier", "Country"], rows: s.map((x) => [x.name, x.country]) });
  }
  if (kind === "parts") {
    const t = await db.select({ code: deviceTypes.code, name: deviceTypes.name }).from(deviceTypes).where(eq(deviceTypes.level, 3)).orderBy(asc(deviceTypes.code)).limit(5000);
    lists.push({ name: "Device types", header: ["Code", "Device type"], rows: t.map((x) => [x.code, x.name]) });
  }
  if (kind === "users") {
    lists.push({ name: "Roles", header: ["Role"], rows: ROLES.map((r) => [ROLE_LABELS[r]]) });
    const f = await db.select({ code: facilities.code, name: facilities.name }).from(facilities).orderBy(asc(facilities.code)).limit(500);
    lists.push({ name: "Hospitals", header: ["Code", "Hospital"], rows: f.map((x) => [x.code, x.name]) });
  }
  return templateResponse(`${kind}-import-template.xlsx`, info.title, info.columns, lists);
}
