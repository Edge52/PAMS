import "server-only";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, facilities, safetyTests } from "@/db/schema";
import { CLASS_LABELS, PROTECTION_CLASSES, type ProtectionClass } from "@/lib/assets/safety-tests";
import { formatDate, formatNumber } from "@/lib/format";
import { complianceTone, plural } from "./calc";
import { emptySafety, latestSafetyState, type SafetyTally } from "./gahar-calc";
import { facilityCond } from "./shared";
import type { ReportContext, ReportResult, Row } from "./types";

const IN_USE = ["INSTALLED", "IN_SERVICE", "UNDER_MAINTENANCE", "OUT_OF_SERVICE", "ON_LOAN"] as const;

/**
 * Electrical safety tests (wave 40, GAHAR 2025 standards EFS.10 EOC 5): per IEC 62353 protection class, tests done and
 * failed in the period, and devices whose latest test failed or is overdue today.
 */
export async function electricalSafetyReport({ filters: f, scope, today }: ReportContext): Promise<ReportResult> {
  const from = f.from ?? today.slice(0, 4) + "-01-01", to = f.to ?? today;
  const fac = facilityCond(assets.facilityId, f, scope);
  const [inPeriod, latest] = await Promise.all([
    db.select({ cls: safetyTests.protectionClass, result: safetyTests.result }).from(safetyTests).innerJoin(assets, eq(assets.id, safetyTests.assetId))
      .where(and(fac, gte(safetyTests.testedOn, from), lte(safetyTests.testedOn, to))).limit(50000),
    db.selectDistinctOn([safetyTests.assetId], {
      assetId: safetyTests.assetId, cls: safetyTests.protectionClass, result: safetyTests.result, testedOn: safetyTests.testedOn, nextDue: safetyTests.nextDue,
      failures: safetyTests.failures, tag: assets.assetTag, typeName: deviceTypes.name, facility: facilities.name,
    }).from(safetyTests).innerJoin(assets, eq(assets.id, safetyTests.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .innerJoin(facilities, eq(facilities.id, assets.facilityId))
      .where(and(fac, inArray(assets.status, [...IN_USE]))).orderBy(safetyTests.assetId, desc(safetyTests.testedOn), desc(safetyTests.id)).limit(20000),
  ]);
  const t = new Map<ProtectionClass, SafetyTally>(PROTECTION_CLASSES.map((c) => [c, emptySafety()]));
  for (const r of inPeriod) {
    const x = t.get(r.cls as ProtectionClass)!;
    x.tests++; if (r.result === "FAIL") x.failed++; else x.passed++;
  }
  const attention: Row[] = [];
  for (const l of latest) {
    const x = t.get(l.cls as ProtectionClass)!;
    x.devices++;
    const s = latestSafetyState(l, today);
    if (s === "failed") x.failedNow++; else if (s === "overdue") x.overdue++; else x.inDate++;
    if (s !== "in_date" && attention.length < 500) attention.push({
      id: l.assetId, tag: l.tag, typeName: l.typeName, facility: l.facility, cls: CLASS_LABELS[l.cls as ProtectionClass], tested: l.testedOn, nextDue: l.nextDue,
      state: s === "failed" ? `Failed: ${l.failures.join(", ") || "see the test"}` : "Overdue",
    });
  }
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const rows: Row[] = PROTECTION_CLASSES.map((c) => {
    const x = t.get(c)!;
    return { cls: CLASS_LABELS[c], tests: x.tests, passed: x.passed, failed: x.failed, devices: x.devices, inDate: x.inDate, overdue: x.overdue, failedNow: x.failedNow, inDatePct: pct(x.inDate, x.devices) };
  });
  const sum = (k: keyof SafetyTally) => [...t.values()].reduce((n, x) => n + x[k], 0);
  const allPct = pct(sum("inDate"), sum("devices"));
  return {
    summary: [
      { label: "Tests in period", value: formatNumber(sum("tests")) },
      { label: "Failed in period", value: formatNumber(sum("failed")) },
      { label: "Tested devices in date", value: allPct == null ? "—" : `${formatNumber(allPct, 1)}%` },
      { label: "Overdue or failed now", value: formatNumber(sum("overdue") + sum("failedNow")) },
    ],
    sections: [{
      key: "classes", title: "By protection class (IEC 62353)",
      columns: [
        { key: "cls", header: "Class", width: 30 },
        { key: "tests", header: "Tests in period", type: "int", width: 12 },
        { key: "passed", header: "Passed", type: "int", width: 10 },
        { key: "failed", header: "Failed", type: "int", width: 10, tone: (r) => (Number(r.failed) > 0 ? "danger" : null) },
        { key: "devices", header: "Devices tested", type: "int", width: 12 },
        { key: "inDate", header: "In date", type: "int", width: 10 },
        { key: "overdue", header: "Overdue", type: "int", width: 10, tone: (r) => (Number(r.overdue) > 0 ? "danger" : null) },
        { key: "failedNow", header: "Last test failed", type: "int", width: 12, tone: (r) => (Number(r.failedNow) > 0 ? "danger" : null) },
        { key: "inDatePct", header: "In date", type: "pct", width: 10, tone: (r) => complianceTone(r.inDatePct) },
      ],
      rows, totals: { cls: "All classes", tests: sum("tests"), passed: sum("passed"), failed: sum("failed"), devices: sum("devices"), inDate: sum("inDate"), overdue: sum("overdue"), failedNow: sum("failedNow"), inDatePct: allPct },
      empty: "No safety tests recorded.",
    }, {
      key: "attention", title: "Overdue or failed",
      columns: [
        { key: "tag", header: "Device", width: 20, mono: true, subKey: "typeName", href: (r) => `/assets/${r.id}` },
        { key: "typeName", header: "Device type", width: 28, only: "excel" },
        { key: "facility", header: "Facility", width: 22 },
        { key: "cls", header: "Class", width: 26 },
        { key: "tested", header: "Last test", type: "date", width: 12 },
        { key: "nextDue", header: "Next due", type: "date", width: 12 },
        { key: "state", header: "State", width: 30, tone: () => "danger" },
      ],
      rows: attention, totals: attention.length ? { tag: plural(attention.length, "device") } : undefined,
      empty: "Every tested device is in date.",
    }],
    notes: [
      `Period ${formatDate(from)} to ${formatDate(to)}. A device counts once, by its latest test, in the class it was tested as.`,
      "Devices never tested don't show here: see Safety tests for what is due.",
    ],
  };
}
