import "server-only";
/** Cost of ownership, room requirements against the CAD rooms, and phasing cash flow for one BOQ. */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { deviceTypes, floors, rooms } from "@/db/schema";
import { num, todayISO } from "@/lib/format";
import { coreKind, polygonArea, rectPoly, type Pt } from "@/components/assets/twin/geometry";
import { cashFlow, cleanPhaseMonths } from "./phasing";
import type { BoqWorkspace } from "./queries";
import { checkRooms, needFor, type ReqRoom } from "./room-requirements";
import { tcoSummary } from "./tco";

export async function roomsCheck(ws: BoqWorkspace) {
  const deptLabel = new Map(ws.depts.map((d) => [d.id, d.realName ? `${d.label} (${d.realName})` : d.label]));
  const lines = ws.lines.filter((l) => l.quantity > 0 && needFor(l.deviceCode));
  if (!lines.length) return [];
  // Real rooms of the linked departments, areas in m² from the CAD outline (or the drawn rectangle).
  const boqDeptOf = new Map<number, number>();
  for (const d of ws.depts) if (d.departmentId != null && !boqDeptOf.has(d.departmentId)) boqDeptOf.set(d.departmentId, d.id);
  const realIds = [...boqDeptOf.keys()];
  const rows = realIds.length ? await db.select({ id: rooms.id, name: rooms.name, code: rooms.code, type: rooms.type, departmentId: rooms.departmentId, polygon: rooms.polygon, x: rooms.x, y: rooms.y, w: rooms.w, h: rooms.h, upm: floors.unitsPerMetre })
    .from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId)).where(inArray(rooms.departmentId, realIds)) : [];
  const reqRooms: ReqRoom[] = rows.filter((r) => r.type !== "CORRIDOR" && !coreKind(r.name)).map((r) => {
    const upm = r.upm ?? 10;
    const poly = (r.polygon && r.polygon.length >= 3 ? r.polygon : rectPoly(r.x, r.y, r.w, r.h)) as Pt[];
    return { id: r.id, departmentBoqId: boqDeptOf.get(r.departmentId!)!, name: r.name, code: r.code, area: Math.round((polygonArea(poly) / (upm * upm)) * 10) / 10 };
  });
  return checkRooms(lines.map((l) => {
    const d = ws.depts.find((x) => x.id === l.boqDepartmentId);
    return { boqDepartmentId: l.boqDepartmentId, department: l.boqDepartmentId != null ? deptLabel.get(l.boqDepartmentId) ?? "Department" : "Hospital-wide", linked: d?.departmentId != null, deviceCode: l.deviceCode, deviceName: l.deviceName, quantity: l.quantity };
  }), reqRooms);
}

export async function boqPlanning(ws: BoqWorkspace) {
  const ids = [...new Set(ws.lines.map((l) => l.deviceTypeId))];
  const life = new Map((ids.length ? await db.select({ id: deviceTypes.id, life: deviceTypes.lifeExpectancyYears }).from(deviceTypes).where(and(inArray(deviceTypes.id, ids))) : []).map((r) => [r.id, r.life]));
  const tcoLines = ws.lines.map((l) => ({ code: l.deviceCode, name: `${l.deviceName}`, quantity: l.quantity, unitPrice: num(l.unitPriceEstimate), lifeYears: life.get(l.deviceTypeId) }));
  const phaseOf = new Map(ws.depts.map((d) => [d.id, d.phase]));
  const opening = ws.boq.openingDate ?? todayISO();
  const flow = cashFlow(ws.lines.map((l) => ({ phase: l.boqDepartmentId != null ? phaseOf.get(l.boqDepartmentId) ?? 1 : 1, code: l.deviceCode, amount: l.quantity * num(l.unitPriceEstimate) })),
    opening, cleanPhaseMonths(ws.boq.phaseMonths));
  return { tco5: tcoSummary(tcoLines, 5), tco10: tcoSummary(tcoLines, 10), flow, opening, openingSet: ws.boq.openingDate != null, phaseMonths: cleanPhaseMonths(ws.boq.phaseMonths) };
}
export type BoqPlanning = Awaited<ReturnType<typeof boqPlanning>>;
