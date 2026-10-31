import { routeGuard } from "@/lib/auth/route-guard";
import { facilityScope, getCurrentUser } from "@/lib/auth/session";
import { toCsv } from "@/lib/assets/csv";
import { parseAssetFilter } from "@/lib/assets/filters";
import { nextPpmDue } from "@/lib/assets/maintenance";
import { ppmInfo, searchAssets } from "@/lib/assets/queries";
import { todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";
const MAX_ROWS = 20000;

/** CSV of the register for the same filters as /assets (page ignored). */
export async function GET(request: Request) {
  const denied = await routeGuard("assets.view");
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const f = { ...parseAssetFilter(params), page: undefined };
  const scope = await facilityScope(await getCurrentUser());
  if (f.facilityId && scope && !scope.includes(f.facilityId)) return new Response("You don't have access to that facility.", { status: 403 });
  const { rows, total } = await searchAssets(f, { limit: MAX_ROWS, offset: 0 }, scope);
  const ppm = new Map<number, { lastPpm: string | null; nextScheduled: string | null }>();
  for (let i = 0; i < rows.length; i += 1000) {
    for (const [k, v] of await ppmInfo(rows.slice(i, i + 1000).map((r) => r.id))) ppm.set(k, v);
  }
  const header = ["Asset tag", "Device type code", "Device type", "Category", "Manufacturer", "Model", "Serial number", "Status", "Condition", "Criticality",
    "Facility", "Building", "Floor", "Department", "Room code", "Room", "Purchase date", "Install date", "Warranty end", "Purchase cost", "Currency", "Last PPM", "Next PPM"];
  const body = rows.map((a) => {
    const info = ppm.get(a.id);
    const next = nextPpmDue({ id: a.id, status: a.status, installDate: a.installDate, purchaseDate: a.purchaseDate, ppmIntervalMonths: a.ppmIntervalMonths, lastPpmDate: info?.lastPpm }).due;
    return [a.assetTag, a.deviceTypeCode, a.deviceTypeName, a.categoryName, a.manufacturer, a.model, a.serialNumber, a.status, a.condition, a.criticality,
      a.facilityCode, a.buildingName, a.floorName, a.departmentName, a.roomCode, a.roomName, a.purchaseDate, a.installDate, a.warrantyEnd,
      a.purchaseCost, a.currency, info?.lastPpm ?? "", info?.nextScheduled && (!next || info.nextScheduled < next) ? info.nextScheduled : next ?? ""];
  });
  const csv = "﻿" + toCsv(header, body); // BOM so Excel reads UTF-8 (Arabic, umlauts)
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="asset-register-${todayISO()}.csv"`,
      "X-Total-Count": String(total),
      "Cache-Control": "no-store",
    },
  });
}
