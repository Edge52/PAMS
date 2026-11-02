import "server-only";
/** Patient pathways (wave 7, step 7b): loading, saving whole pathways, versions, and the JSON file format. */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { buildings, departments, deviceTypes, flowLinks, flowSteps, floors, patientFlows, rooms } from "@/db/schema";
import type { FlowKind, Link, Step } from "./model";

export type FlowRow = typeof patientFlows.$inferSelect;

export async function loadFlow(id: number) {
  const [flow] = await db.select().from(patientFlows).where(eq(patientFlows.id, id));
  if (!flow) return null;
  const steps = await db.select().from(flowSteps).where(eq(flowSteps.flowId, id)).orderBy(asc(flowSteps.sort), asc(flowSteps.id));
  const links = await db.select().from(flowLinks).where(eq(flowLinks.flowId, id)).orderBy(asc(flowLinks.id));
  return {
    flow,
    steps: steps.map((s): Step & { id: number } => ({ id: s.id, key: s.key, label: s.label, kind: s.kind, departmentId: s.departmentId, roomId: s.roomId, minutes: s.minutes, accompanying: s.accompanying, equipment: s.equipment ?? [], notes: s.notes })),
    links: links.map((l): Link & { id: number } => ({ id: l.id, fromKey: l.fromKey, toKey: l.toKey, share: l.share, transport: l.transport, urgency: l.urgency, condition: l.condition })),
  };
}

/** Create a pathway with its steps and arrows (a new one, a copy of a starter, an import, or a new version). */
export async function createFlow(input: {
  facilityId: number; name: string; kind?: FlowKind; dailyVolume?: number | null; arrivalProfile?: number[] | null; description?: string | null;
  starter?: string | null; ownerName?: string | null; lineageId?: number | null; version?: number; steps: Step[]; links: Link[];
}): Promise<number> {
  return db.transaction(async (tx) => {
    const [f] = await tx.insert(patientFlows).values({
      facilityId: input.facilityId, name: input.name, kind: input.kind ?? "PATIENT", dailyVolume: input.dailyVolume ?? null,
      arrivalProfile: input.arrivalProfile ?? null, description: input.description ?? null, starter: input.starter ?? null,
      ownerName: input.ownerName ?? null, version: input.version ?? 1, lineageId: input.lineageId ?? null,
    }).returning({ id: patientFlows.id });
    if (input.lineageId == null) await tx.update(patientFlows).set({ lineageId: f.id }).where(eq(patientFlows.id, f.id));
    if (input.steps.length) await tx.insert(flowSteps).values(input.steps.map((s, i) => ({
      flowId: f.id, key: s.key, label: s.label, kind: s.kind, departmentId: s.departmentId, roomId: s.roomId, minutes: s.minutes,
      accompanying: s.accompanying, equipment: s.equipment, notes: s.notes, sort: i,
    })));
    if (input.links.length) await tx.insert(flowLinks).values(input.links.map((l) => ({
      flowId: f.id, fromKey: l.fromKey, toKey: l.toKey, share: l.share, transport: l.transport, urgency: l.urgency, condition: l.condition,
    })));
    return f.id;
  });
}

/** A new draft version of a pathway, copied from the given version. */
export async function newVersion(id: number, ownerName: string): Promise<number | null> {
  const f = await loadFlow(id); if (!f) return null;
  const versions = await db.select({ v: patientFlows.version }).from(patientFlows).where(eq(patientFlows.lineageId, f.flow.lineageId ?? f.flow.id));
  return createFlow({
    facilityId: f.flow.facilityId, name: f.flow.name, kind: f.flow.kind, dailyVolume: f.flow.dailyVolume, arrivalProfile: f.flow.arrivalProfile,
    description: f.flow.description, starter: f.flow.starter, ownerName, lineageId: f.flow.lineageId ?? f.flow.id,
    version: Math.max(0, ...versions.map((v) => v.v)) + 1, steps: f.steps, links: f.links,
  });
}

/* ── File format: rooms and departments by code, so a pathway moves between installations ── */

export type FlowFile = {
  format: "hpams-pathway"; formatVersion: 1;
  name: string; kind: FlowKind; dailyVolume: number | null; arrivalProfile: number[] | null; description: string | null;
  steps: (Omit<Step, "departmentId" | "roomId"> & { department: string | null; room: { code: string; floorLevel: number } | null })[];
  links: Link[];
};

export async function exportFlow(id: number): Promise<FlowFile | null> {
  const f = await loadFlow(id); if (!f) return null;
  const deptIds = f.steps.map((s) => s.departmentId).filter((v): v is number => v != null);
  const roomIds = f.steps.map((s) => s.roomId).filter((v): v is number => v != null);
  const ds = deptIds.length ? await db.select({ id: departments.id, code: departments.code }).from(departments).where(inArray(departments.id, deptIds)) : [];
  const rs = roomIds.length ? await db.select({ id: rooms.id, code: rooms.code, level: floors.level }).from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId)).where(inArray(rooms.id, roomIds)) : [];
  return {
    format: "hpams-pathway", formatVersion: 1, name: f.flow.name, kind: f.flow.kind, dailyVolume: f.flow.dailyVolume, arrivalProfile: f.flow.arrivalProfile, description: f.flow.description,
    steps: f.steps.map(({ id: _id, departmentId, roomId, ...s }) => {
      void _id;
      const r = rs.find((x) => x.id === roomId);
      return { ...s, department: ds.find((d) => d.id === departmentId)?.code ?? null, room: r ? { code: r.code, floorLevel: r.level } : null };
    }),
    links: f.links.map(({ id: _id, ...l }) => { void _id; return l; }),
  };
}

/** Resolve a file's departments and rooms against a hospital; returns steps and what couldn't be matched. */
export async function resolveFile(facilityId: number, file: FlowFile): Promise<{ steps: Step[]; links: Link[]; unmatched: string[] }> {
  const ds = await db.select({ id: departments.id, code: departments.code }).from(departments).where(eq(departments.facilityId, facilityId));
  const rs = await db.select({ id: rooms.id, code: rooms.code, level: floors.level }).from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId))
    .innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facilityId));
  const unmatched: string[] = [];
  const steps = file.steps.map((s): Step => {
    const dept = s.department ? ds.find((d) => d.code.toUpperCase() === s.department!.toUpperCase()) ?? null : null;
    const room = s.room ? rs.find((r) => r.code.toUpperCase() === s.room!.code.toUpperCase() && r.level === s.room!.floorLevel) ?? null : null;
    if ((s.department && !dept) || (s.room && !room)) unmatched.push(s.label);
    return { key: s.key, label: s.label, kind: s.kind, departmentId: dept?.id ?? null, roomId: room?.id ?? null, minutes: s.minutes, accompanying: s.accompanying, equipment: s.equipment ?? [], notes: s.notes };
  });
  return { steps, links: file.links, unmatched };
}

/** Departments and rooms of a hospital for the editor's pickers. */
export async function placesOf(facilityId: number) {
  const ds = await db.select({ id: departments.id, name: departments.name, code: departments.code, typeCode: departments.departmentTypeCode }).from(departments)
    .where(eq(departments.facilityId, facilityId)).orderBy(asc(departments.name));
  const rs = await db.select({ id: rooms.id, name: rooms.name, code: rooms.code, departmentId: rooms.departmentId, floorName: floors.name, level: floors.level })
    .from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId))
    .where(and(eq(buildings.facilityId, facilityId))).orderBy(asc(floors.level), asc(rooms.name));
  return { departments: ds, rooms: rs };
}

/** Catalogue names of equipment codes ("IMG-CT-128" → "CT scanner, 128-slice"), for readiness lines. */
export async function equipmentNames(codes: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(codes)];
  if (!uniq.length) return {};
  const rows = await db.select({ code: deviceTypes.code, name: deviceTypes.name }).from(deviceTypes).where(inArray(deviceTypes.code, uniq));
  return Object.fromEntries(rows.map((r) => [r.code, r.name]));
}
