import "server-only";
/** Database side of the national guideline (wave 41): lookups for the template, the imported sets, the comparison. */
import { asc, desc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { boqRules, departmentTypes, deviceTypes, standardSets } from "@/db/schema";
import { compareWithGuideline, GUIDELINE_CODE_PREFIX, type GuidelineLookups } from "./guideline";
import { deviceCatalogue, type BoqWorkspace } from "./queries";

export async function guidelineLookups(): Promise<GuidelineLookups> {
  const [dts, devs] = await Promise.all([
    db.select({ code: departmentTypes.code, name: departmentTypes.name }).from(departmentTypes),
    db.select({ id: deviceTypes.id, code: deviceTypes.code, name: deviceTypes.name, level: deviceTypes.level }).from(deviceTypes),
  ]);
  const departmentTypesMap = new Map<string, string>();
  for (const d of dts) { departmentTypesMap.set(d.name.toLowerCase(), d.code); departmentTypesMap.set(d.code.toLowerCase(), d.code); }
  const deviceTypesMap = new Map<string, { id: number; code: string; level: number }>();
  // Names first, codes after: a code always wins over a name that happens to read the same.
  for (const d of devs) if (d.level === 3 || !deviceTypesMap.has(d.name.toLowerCase())) deviceTypesMap.set(d.name.toLowerCase(), d);
  for (const d of devs) deviceTypesMap.set(d.code.toLowerCase(), d);
  return { departmentTypes: departmentTypesMap, deviceTypes: deviceTypesMap };
}

/** Imported guideline sets, newest first. */
export async function guidelineSets() {
  return db.select({ id: standardSets.id, code: standardSets.code, name: standardSets.name, version: standardSets.version, updatedAt: standardSets.updatedAt })
    .from(standardSets).where(like(standardSets.code, `${GUIDELINE_CODE_PREFIX}%`)).orderBy(desc(standardSets.updatedAt)).limit(20);
}

/** "This BOQ vs the guideline": the comparison with the chosen (else the newest) imported guideline. */
export async function boqVsGuideline(ws: BoqWorkspace, setId?: number | null) {
  const sets = await guidelineSets();
  const set = sets.find((s) => s.id === setId) ?? sets[0];
  if (!set) return { sets, set: null, rows: [] };
  const [rules, catalogue] = await Promise.all([
    db.select().from(boqRules).where(eq(boqRules.standardSetId, set.id)).orderBy(asc(boqRules.id)).limit(5000),
    deviceCatalogue(),
  ]);
  const rows = compareWithGuideline(ws.depts.map((d) => ({ ...d, params: d.params ?? {} })), ws.lines, rules, ws.boq.totalHospitalBeds)
    .map((r) => ({ ...r, deviceCode: catalogue.get(r.deviceTypeId)?.code ?? "?", deviceName: catalogue.get(r.deviceTypeId)?.name ?? `Device #${r.deviceTypeId}` }));
  return { sets, set, rows };
}
