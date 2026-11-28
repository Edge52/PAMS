import { asc } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { routeGuard } from "@/lib/auth/route-guard";
import { HOLIDAY_COLUMNS } from "@/lib/holidays";
import { templateResponse } from "@/lib/imports/read-server";

export const dynamic = "force-dynamic";

/** Excel template for the public holidays import (wave 43), with the hospital codes. */
export async function GET() {
  const denied = await routeGuard("settings.manage");
  if (denied) return denied;
  const f = await db.select({ code: facilities.code, name: facilities.name }).from(facilities).orderBy(asc(facilities.code)).limit(500);
  return templateResponse("public-holidays-template.xlsx", "Holidays", HOLIDAY_COLUMNS, [{ name: "Hospitals", header: ["Code", "Hospital"], rows: f.map((x) => [x.code, x.name]) }],
    "Delete the example row (row 2) before importing. Islamic holidays move each year: enter them when their dates are announced, with Moves each year = Yes.");
}
