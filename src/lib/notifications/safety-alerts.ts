import "server-only";
/** Wave 37: loads the rows for ./safety-alert-rules (recalls, stock, safety tests, calibration, radiation safety). */
import { and, desc, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assets, departments, deviceTypes, dosimetryPeriods, protectiveChecks, protectiveItems, radiationLicences, radiationQcTests, recallAssets, recalls, rooms,
  safetyTests, spareParts,
} from "@/db/schema";
import { addDaysISO } from "@/lib/format";
import { calibrationDevices } from "@/lib/assets/calibration-server";
import { CHECK_WARN_DAYS, LICENCE_WARN_DAYS, latestBy } from "@/lib/assets/radiation";
import type { SafetyAlertData } from "./safety-alert-rules";

export async function loadSafetyAlertData(today: string): Promise<SafetyAlertData> {
  const soon = addDaysISO(today, CHECK_WARN_DAYS);
  const licHorizon = addDaysISO(today, LICENCE_WARN_DAYS);
  const yearAgo = addDaysISO(today, -365);
  const [recallRows, partRows, testRows, calRows, eqRows, licRows, qcRows, itemRows, checkRows, doseRows] = await Promise.all([
    db.select({ recallId: recalls.id, number: recalls.number, title: recalls.title, urgent: recalls.urgent, dueDate: recalls.dueDate, facilityId: assets.facilityId,
      pending: sql<number>`count(*)::int` }).from(recallAssets).innerJoin(recalls, eq(recalls.id, recallAssets.recallId)).innerJoin(assets, eq(assets.id, recallAssets.assetId))
      .where(and(eq(recalls.status, "OPEN"), eq(recallAssets.status, "PENDING"), ne(assets.status, "DISPOSED")))
      .groupBy(recalls.id, recalls.number, recalls.title, recalls.urgent, recalls.dueDate, assets.facilityId),
    db.select({ id: spareParts.id, name: spareParts.name, partNumber: spareParts.partNumber, stock: spareParts.stockQty, min: spareParts.minQty, facilityId: spareParts.facilityId })
      .from(spareParts).where(and(eq(spareParts.active, true), sql`${spareParts.minQty} > 0`, sql`${spareParts.stockQty} <= ${spareParts.minQty}`)),
    db.selectDistinctOn([safetyTests.assetId], { assetId: safetyTests.assetId, result: safetyTests.result, nextDue: safetyTests.nextDue, tag: assets.assetTag,
      typeName: deviceTypes.name, departmentName: departments.name, facilityId: assets.facilityId })
      .from(safetyTests).innerJoin(assets, eq(assets.id, safetyTests.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .leftJoin(departments, eq(departments.id, assets.departmentId)).where(inArray(assets.status, ["INSTALLED", "IN_SERVICE", "UNDER_MAINTENANCE", "OUT_OF_SERVICE"]))
      .orderBy(safetyTests.assetId, desc(safetyTests.testedOn), desc(safetyTests.id)),
    calibrationDevices(null, today),
    db.select({ assetId: assets.id, tag: assets.assetTag, manufacturer: assets.manufacturer, model: assets.model, calibrationDue: assets.calibrationDue, facilityId: assets.facilityId })
      .from(assets).where(and(eq(assets.isTestEquipment, true), ne(assets.status, "DISPOSED"), isNotNull(assets.calibrationDue), lte(assets.calibrationDue, soon))),
    db.select({ id: radiationLicences.id, licenceNumber: radiationLicences.licenceNumber, expiresOn: radiationLicences.expiresOn, facilityId: radiationLicences.facilityId,
      roomName: rooms.name, tag: assets.assetTag }).from(radiationLicences).leftJoin(rooms, eq(rooms.id, radiationLicences.roomId)).leftJoin(assets, eq(assets.id, radiationLicences.assetId))
      .where(and(eq(radiationLicences.active, true), lte(radiationLicences.expiresOn, licHorizon))),
    db.select({ id: radiationQcTests.id, assetId: radiationQcTests.assetId, roomId: radiationQcTests.roomId, testName: radiationQcTests.testName, testedOn: radiationQcTests.testedOn,
      result: radiationQcTests.result, nextDue: radiationQcTests.nextDue, facilityId: radiationQcTests.facilityId, tag: assets.assetTag, roomName: rooms.name, assetStatus: assets.status })
      .from(radiationQcTests).leftJoin(assets, eq(assets.id, radiationQcTests.assetId)).leftJoin(rooms, eq(rooms.id, radiationQcTests.roomId)),
    db.select({ id: protectiveItems.id, label: protectiveItems.label, kind: protectiveItems.kind, facilityId: protectiveItems.facilityId, roomName: rooms.name }).from(protectiveItems)
      .leftJoin(rooms, eq(rooms.id, protectiveItems.roomId)).where(eq(protectiveItems.active, true)),
    db.select({ id: protectiveChecks.id, itemId: protectiveChecks.itemId, checkedOn: protectiveChecks.checkedOn, nextDue: protectiveChecks.nextDue }).from(protectiveChecks)
      .innerJoin(protectiveItems, eq(protectiveItems.id, protectiveChecks.itemId)).where(eq(protectiveItems.active, true)),
    db.select({ id: dosimetryPeriods.id, personName: dosimetryPeriods.personName, periodEnd: dosimetryPeriods.periodEnd, doseMsv: dosimetryPeriods.doseMsv,
      limitMsv: dosimetryPeriods.limitMsv, flag: dosimetryPeriods.flag, facilityId: dosimetryPeriods.facilityId })
      .from(dosimetryPeriods).where(and(ne(dosimetryPeriods.flag, "OK"), gte(dosimetryPeriods.periodEnd, yearAgo))),
  ]);
  // A later QC test of the same thing replaces the earlier one; only the latest counts.
  const qcLatest = latestBy(qcRows.filter((q) => q.assetStatus !== "DISPOSED"),
    (q) => `${q.assetId ? `a${q.assetId}` : `r${q.roomId}`}|${q.testName.trim().toLowerCase()}`, (q) => q.testedOn);
  const lastCheck = latestBy(checkRows, (c) => String(c.itemId), (c) => c.checkedOn);
  return {
    recalls: recallRows.map((r) => ({ ...r, pending: Number(r.pending) })),
    parts: partRows,
    safetyTests: testRows.filter((t) => t.result === "PASS" && t.nextDue && t.nextDue <= soon)
      .map((t) => ({ assetId: t.assetId, tag: t.tag, typeName: t.typeName, departmentName: t.departmentName, nextDue: t.nextDue!, facilityId: t.facilityId })),
    calibrations: calRows.filter((c) => (c.state === "soon" || c.state === "overdue") && c.last?.nextDue)
      .map((c) => ({ assetId: c.id, tag: c.tag, typeName: c.typeName, departmentName: c.departmentName, nextDue: c.last!.nextDue!, facilityId: c.facilityId })),
    testEquipment: eqRows.map((e) => ({ assetId: e.assetId, tag: e.tag, label: [e.manufacturer, e.model].filter(Boolean).join(" ") || e.tag, calibrationDue: e.calibrationDue!, facilityId: e.facilityId })),
    licences: licRows.map((l) => ({ id: l.id, licenceNumber: l.licenceNumber, expiresOn: l.expiresOn, facilityId: l.facilityId, covers: [l.roomName, l.tag].filter(Boolean).join(", ") || "The licensed room" })),
    qc: [...qcLatest.values()].filter((q) => q.result === "PASS" && q.nextDue && q.nextDue <= soon)
      .map((q) => ({ id: q.id, testName: q.testName, label: q.tag ?? q.roomName ?? "room", nextDue: q.nextDue!, facilityId: q.facilityId })),
    protective: itemRows.flatMap((i) => {
      const c = lastCheck.get(String(i.id));
      return c?.nextDue && c.nextDue <= soon ? [{ itemId: i.id, label: i.roomName ? `${i.label} (${i.roomName})` : i.label, kind: i.kind, nextDue: c.nextDue, facilityId: i.facilityId }] : [];
    }),
    doses: doseRows,
  };
}
