import { routeGuard } from "@/lib/auth/route-guard";
import { facilityScope, getCurrentUser } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/assets/access";
import ExcelJS from "exceljs";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, departments, floors, rooms } from "@/db/schema";
import { IMPORT_COLUMNS } from "@/lib/assets/import";
import { deviceTypeOptions } from "@/lib/assets/queries";

export const dynamic = "force-dynamic";

/** Downloadable import template: an Assets sheet with headers + example row, plus reference sheets of valid codes. */
export async function GET(request: Request) {
  const denied = await routeGuard("assets.edit");
  if (denied) return denied;
  const facilityId = Number(new URL(request.url).searchParams.get("facilityId")) || null;
  const scope = await facilityScope(await getCurrentUser());
  if (facilityId && scope && !scope.includes(facilityId)) return new Response("You don't have access to that facility.", { status: 403 });
  const wb = new ExcelJS.Workbook();
  wb.creator = "Hospital PAMS";
  const ws = wb.addWorksheet("Assets", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: Math.max(14, c.header.length + 4) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).eachCell((cell, i) => {
    cell.note = IMPORT_COLUMNS[i - 1].hint;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFEB" } };
  });
  ws.addRow(Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, c.example])));
  ws.getRow(2).font = { italic: true, color: { argb: "FF5A6865" } };

  const help = wb.addWorksheet("How to fill");
  help.columns = [{ header: "Column", key: "h", width: 22 }, { header: "Required", key: "r", width: 10 }, { header: "What to enter", key: "d", width: 90 }];
  help.getRow(1).font = { bold: true };
  for (const c of IMPORT_COLUMNS) help.addRow({ h: c.header, r: c.required ? "Yes" : "", d: c.hint });
  help.addRow({});
  help.addRow({ h: "Tip", d: "Delete the example row (row 2) before importing. One row per physical unit. Codes are not case-sensitive." });

  const types = wb.addWorksheet("Device types");
  types.columns = [{ header: "Code", key: "code", width: 20 }, { header: "Device type", key: "name", width: 48 }, { header: "Group", key: "g", width: 34 }, { header: "Category", key: "c", width: 34 }];
  types.getRow(1).font = { bold: true };
  for (const t of await deviceTypeOptions()) types.addRow({ code: t.code, name: t.name, g: t.groupName, c: t.categoryName });

  const rs = wb.addWorksheet("Rooms");
  rs.columns = [{ header: "Room code", key: "code", width: 18 }, { header: "Room", key: "name", width: 28 }, { header: "Department code", key: "dc", width: 16 }, { header: "Department", key: "dn", width: 30 }, { header: "Floor", key: "f", width: 18 }];
  rs.getRow(1).font = { bold: true };
  const roomRows = await db.select({ code: rooms.code, name: rooms.name, dc: departments.code, dn: departments.name, f: floors.name })
    .from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId))
    .leftJoin(departments, eq(departments.id, rooms.departmentId))
    .where(and(facilityId ? eq(buildings.facilityId, facilityId) : undefined, scopeWhere(buildings.facilityId, scope))).orderBy(asc(floors.level), asc(rooms.code));
  for (const r of roomRows) rs.addRow(r);

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="asset-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
