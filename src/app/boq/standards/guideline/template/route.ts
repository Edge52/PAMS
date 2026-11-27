import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { departmentTypes, deviceTypes } from "@/db/schema";
import { routeGuard } from "@/lib/auth/route-guard";
import { GUIDELINE_COLUMNS } from "@/lib/boq/guideline";
import { templateResponse } from "@/lib/imports/read-server";

export const dynamic = "force-dynamic";

/** The National Medical Equipment Guideline template (wave 41), with the valid department and device types. */
export async function GET() {
  const denied = await routeGuard("boq.view");
  if (denied) return denied;
  const [dts, devs] = await Promise.all([
    db.select({ code: departmentTypes.code, name: departmentTypes.name }).from(departmentTypes).orderBy(asc(departmentTypes.sortOrder)).limit(500),
    db.select({ code: deviceTypes.code, name: deviceTypes.name }).from(deviceTypes).where(eq(deviceTypes.level, 3)).orderBy(asc(deviceTypes.code)).limit(5000),
  ]);
  return templateResponse("national-guideline-template.xlsx", "Guideline", GUIDELINE_COLUMNS, [
    { name: "Department types", header: ["Code", "Department type"], rows: dts.map((d) => [d.code, d.name]) },
    { name: "Device types", header: ["Code", "Device type"], rows: devs.map((d) => [d.code, d.name]) },
  ], "One row per department type, room type and device, from the guideline's app. Fill one quantity column per row. Delete the example row (row 2) first.");
}
