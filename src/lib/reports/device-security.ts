import "server-only";
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { assets, assetSecurity, deviceTypes, facilities } from "@/db/schema";
import { concerns, CONNECTION_LABELS, TRI_LABELS, worst } from "@/lib/assets/device-security";
import { formatNumber } from "@/lib/format";
import { plural } from "./calc";
import { facilityCond } from "./shared";
import type { ReportContext, ReportResult, Row } from "./types";

/** Devices with network and security details (wave 26, from wave 25's records), worst first. */
export async function deviceSecurityReport({ filters: f, scope, today }: ReportContext): Promise<ReportResult> {
  const list = await db.select({ s: assetSecurity, id: assets.id, tag: assets.assetTag, deviceType: deviceTypes.name, facility: facilities.name })
    .from(assetSecurity).innerJoin(assets, eq(assets.id, assetSecurity.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .innerJoin(facilities, eq(facilities.id, assets.facilityId))
    .where(and(facilityCond(assets.facilityId, f, scope), ne(assets.status, "DISPOSED"))).orderBy(asc(assets.assetTag));
  const rank = { high: 0, medium: 1, none: 2 } as const;
  const rows: Row[] = list.map((r) => {
    const c = concerns(r.s, today), level = worst(c);
    return {
      id: r.id, tag: r.tag, deviceType: r.deviceType, facility: r.facility, connection: CONNECTION_LABELS[r.s.connection], ip: r.s.ipAddress,
      os: r.s.operatingSystem, osEnds: r.s.osSupportEnds, patched: r.s.lastPatchedOn, patient: TRI_LABELS[r.s.storesPatientData],
      level: level === "high" ? "Needs attention" : level === "medium" ? "To check" : "Nothing", rank: rank[level],
      concerns: c.map((x) => x.text).join(" "), reviewed: r.s.reviewedOn,
    };
  }).sort((a, b) => (a.rank as number) - (b.rank as number));
  const high = rows.filter((r) => r.rank === 0).length;
  return {
    summary: [
      { label: "Devices recorded", value: formatNumber(rows.length) },
      { label: "Need attention", value: formatNumber(high) },
      { label: "Out of support", value: formatNumber(list.filter((r) => r.s.connection !== "NONE" && r.s.osSupportEnds && r.s.osSupportEnds < today).length) },
    ],
    sections: [{
      key: "devices",
      columns: [
        { key: "tag", header: "Device", width: 20, mono: true, subKey: "deviceType", href: (r) => `/assets/${r.id}` },
        { key: "deviceType", header: "Device type", width: 30, only: "excel" },
        { key: "facility", header: "Facility", width: 24 },
        { key: "connection", header: "Connection", width: 14, subKey: "ip" },
        { key: "ip", header: "IP address", width: 16, only: "excel" },
        { key: "os", header: "Operating system", width: 30 },
        { key: "osEnds", header: "Fixes until", type: "date", width: 12, tone: (r) => (typeof r.osEnds === "string" && r.osEnds < today ? "danger" : null) },
        { key: "patched", header: "Last update", type: "date", width: 12 },
        { key: "patient", header: "Holds patient data", width: 10 },
        { key: "level", header: "Status", width: 16, tone: (r) => (r.rank === 0 ? "danger" : r.rank === 1 ? "warn" : "ok") },
        { key: "concerns", header: "To check", width: 60 },
        { key: "reviewed", header: "Reviewed", type: "date", width: 12 },
      ],
      rows, totals: rows.length ? { tag: plural(rows.length, "device") } : undefined,
      empty: "No device has network and security details yet. Record them on each device's page.",
    }],
  };
}
