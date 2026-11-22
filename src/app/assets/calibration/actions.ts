"use server";
/**
 * Calibration of clinical devices (wave 37). Recording a calibration needs `maintenance.edit`; a device's own interval
 * `assets.edit`; a device type's interval `catalogue.edit`. A failed calibration takes the device out of service
 * until a passing one is recorded (rules in src/lib/assets/calibration.ts).
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { assetCalibration, assets, calibrations, deviceTypeCalibration, deviceTypes, maintenanceEvents, suppliers } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formObject, id, int, reqId, text } from "@/lib/assets/forms";
import { CALIBRATION_RESULT_LABELS, CALIBRATION_RESULTS, nextCalibrationDue, statusAfterCalibration } from "@/lib/assets/calibration";
import { intervalFor, lastCalibration } from "@/lib/assets/calibration-server";
import { hasDisposalPending, otherDownJobs } from "@/lib/assets/work-order-server";
import { fail, zodFail, type ActionState } from "@/lib/procurement/forms";
import { formatDate, todayISO } from "@/lib/format";
import { humanize } from "@/lib/status";
import { logActivity } from "@/lib/server-utils";

const reqDate = (label: string) => z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.string({ error: `Enter the ${label}.` }).regex(/^\d{4}-\d{2}-\d{2}$/, `Enter the ${label}.`));
const reqStr = (label: string, max = 200) => z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.string({ error: `Enter ${label}.` }).max(max, `Keep this under ${max} characters.`));

const RecordSchema = z.object({
  assetId: reqId("Device"), calibratedOn: reqDate("calibration date"), performedBy: reqStr("who did the calibration", 160), vendorId: id(),
  certificateRef: text(120), result: z.enum(CALIBRATION_RESULTS, { error: "Choose the result." }), notes: text(2000),
});

export async function recordCalibrationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("maintenance.edit");
  const p = RecordSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, status: assets.status, deviceTypeId: assets.deviceTypeId })
    .from(assets).where(eq(assets.id, d.assetId));
  if (!a) return fail("That device is not in the register.");
  await requireFacilityAccess(a.facilityId, me);
  if (a.status === "DISPOSED") return fail("This device has been disposed of.");
  if (d.calibratedOn > todayISO()) return { errors: ["The calibration date can't be in the future."], fields: { calibratedOn: "This date is in the future." } };
  if (d.vendorId) {
    const [v] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, d.vendorId));
    if (!v) return { errors: ["Choose a supplier from the list."], fields: { vendorId: "Not a known supplier." } };
  }
  // Lookups before the transaction (PGlite has one connection).
  const [iv, prev, others, disposal, [openEvent]] = await Promise.all([
    intervalFor(a.id, a.deviceTypeId), lastCalibration(a.id), otherDownJobs(a.id, 0), hasDisposalPending(a.id),
    db.select({ id: maintenanceEvents.id }).from(maintenanceEvents)
      .where(and(eq(maintenanceEvents.assetId, a.id), eq(maintenanceEvents.type, "CALIBRATION"), inArray(maintenanceEvents.status, ["SCHEDULED", "IN_PROGRESS", "OVERDUE"])))
      .orderBy(asc(maintenanceEvents.scheduledDate)).limit(1),
  ]);
  if (prev && d.calibratedOn < prev.calibratedOn) return { errors: [`The last calibration on record is dated ${prev.calibratedOn}. Record calibrations in order.`], fields: { calibratedOn: "Earlier than the last calibration." } };
  const nextDue = nextCalibrationDue(d.calibratedOn, iv.months, d.result);
  const previousFailed = prev?.result === "FAIL";
  const next = statusAfterCalibration(d.result, { assetStatus: a.status, previousFailed, statusBefore: prev?.statusBefore, otherDownJobs: others, disposalPending: disposal });
  const label = CALIBRATION_RESULT_LABELS[d.result];
  const findings = `Calibration: ${label.toLowerCase()}${d.certificateRef ? `, certificate ${d.certificateRef}` : ""}${d.notes ? `. ${d.notes}` : ""}`.slice(0, 4000);

  const row = await db.transaction(async (tx) => {
    let eventId: number;
    if (openEvent) {
      await tx.update(maintenanceEvents).set({ status: "COMPLETED", completedDate: d.calibratedOn, performedBy: d.performedBy, vendorId: d.vendorId ?? null, findings })
        .where(eq(maintenanceEvents.id, openEvent.id));
      eventId = openEvent.id;
    } else {
      const [ev] = await tx.insert(maintenanceEvents).values({
        assetId: a.id, type: "CALIBRATION", status: "COMPLETED", scheduledDate: d.calibratedOn, completedDate: d.calibratedOn,
        performedBy: d.performedBy, vendorId: d.vendorId ?? null, findings,
      }).returning({ id: maintenanceEvents.id });
      eventId = ev.id;
    }
    const [r] = await tx.insert(calibrations).values({
      assetId: a.id, facilityId: a.facilityId, calibratedOn: d.calibratedOn, performedBy: d.performedBy, vendorId: d.vendorId ?? null,
      certificateRef: d.certificateRef ?? null, result: d.result, intervalMonths: d.result === "FAIL" ? null : iv.months, nextDue, notes: d.notes ?? null,
      statusBefore: d.result === "FAIL" ? (next ? a.status : prev?.result === "FAIL" ? prev.statusBefore : a.status) : null,
      maintenanceEventId: eventId, recordedById: me.id, recordedByName: me.name,
    }).returning({ id: calibrations.id });
    if (next) {
      await tx.update(assets).set({ status: next as typeof a.status }).where(eq(assets.id, a.id));
      await logActivity("asset", a.id, "status_changed",
        `Status ${humanize(a.status).toLowerCase()} → ${humanize(next).toLowerCase()} (${d.result === "FAIL" ? "failed calibration" : "calibration passed"})`, me.name, tx);
    }
    await logActivity("asset", a.id, "calibration", `Calibration ${d.calibratedOn}: ${label.toLowerCase()}${nextDue ? `, next due ${nextDue}` : ""}`.slice(0, 300), me.name, tx);
    await logActivity("calibration", r.id, "created", `${a.tag}: ${label.toLowerCase()} by ${d.performedBy}`.slice(0, 300), me.name, tx);
    return r;
  });
  revalidatePath(`/assets/${a.id}`); revalidatePath("/assets/calibration"); revalidatePath("/assets/maintenance");
  const msg = d.result === "FAIL"
    ? `Failed. ${next ? "The device is now out of service" : "The device stays out of use"} until a passing calibration is recorded. Raise a work order for the repair.`
    : `Saved. Next calibration due ${formatDate(nextDue)}.${next ? ` The device is back to ${humanize(next).toLowerCase()}.` : previousFailed ? " It is still kept down by an open job or a disposal." : ""} Attach the certificate below.`;
  return redirect(`/assets/calibration/${row.id}?${d.result === "FAIL" ? "error" : "notice"}=${encodeURIComponent(msg)}`);
}

const IntervalSchema = z.object({ assetId: reqId("Device"), intervalMonths: int("Interval", 1, 120), reason: text(300) });

/** A device's own calibration interval; blank goes back to the type's. */
export async function setAssetCalibrationIntervalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const p = IntervalSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [a] = await db.select({ id: assets.id, facilityId: assets.facilityId }).from(assets).where(eq(assets.id, d.assetId));
  if (!a) return fail("That device is not in the register.");
  await requireFacilityAccess(a.facilityId, me);
  const [before] = await db.select().from(assetCalibration).where(eq(assetCalibration.assetId, a.id));
  if (d.intervalMonths == null) {
    if (!before) return { message: "Nothing changed." };
    await db.delete(assetCalibration).where(eq(assetCalibration.assetId, a.id));
    await logActivity("asset", a.id, "updated", `Calibration interval: back to the device type's (was every ${before.intervalMonths} months)`, me.name);
  } else {
    if (before && before.intervalMonths === d.intervalMonths && (before.reason ?? null) === (d.reason ?? null)) return { message: "Nothing changed." };
    await db.insert(assetCalibration).values({ assetId: a.id, intervalMonths: d.intervalMonths, reason: d.reason ?? null })
      .onConflictDoUpdate({ target: assetCalibration.assetId, set: { intervalMonths: d.intervalMonths, reason: d.reason ?? null } });
    await logActivity("asset", a.id, "updated", `Calibration interval: every ${d.intervalMonths} months${before ? ` (was ${before.intervalMonths})` : ""}${d.reason ? ` — ${d.reason}` : ""}`.slice(0, 300), me.name);
  }
  revalidatePath(`/assets/${a.id}`); revalidatePath("/assets/calibration");
  return redirect(`/assets/${a.id}?notice=${encodeURIComponent("Calibration interval saved. It applies from the next calibration.")}#calibration`);
}

const TypeIntervalSchema = z.object({ code: reqStr("the device type", 48), intervalMonths: int("Interval", 1, 120) });

/** A device type's calibration interval (the default for its devices); blank = 12 months. */
export async function setTypeCalibrationIntervalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("catalogue.edit");
  const p = TypeIntervalSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [dt] = await db.select({ id: deviceTypes.id, name: deviceTypes.name, code: deviceTypes.code }).from(deviceTypes).where(eq(deviceTypes.code, d.code.toUpperCase()));
  if (!dt) return fail("That device type no longer exists.");
  const [before] = await db.select().from(deviceTypeCalibration).where(eq(deviceTypeCalibration.deviceTypeId, dt.id));
  if ((before?.intervalMonths ?? null) === (d.intervalMonths ?? null)) return { message: "Nothing changed." };
  if (d.intervalMonths == null) await db.delete(deviceTypeCalibration).where(eq(deviceTypeCalibration.deviceTypeId, dt.id));
  else await db.insert(deviceTypeCalibration).values({ deviceTypeId: dt.id, intervalMonths: d.intervalMonths })
    .onConflictDoUpdate({ target: deviceTypeCalibration.deviceTypeId, set: { intervalMonths: d.intervalMonths } });
  await logActivity("device_type", dt.id, "updated", `${dt.name}: calibration every ${d.intervalMonths ?? 12} months${d.intervalMonths == null ? " (default)" : ""}${before ? ` (was ${before.intervalMonths})` : ""}`, me.name);
  revalidatePath(`/catalogue/${dt.code}`); revalidatePath("/assets/calibration");
  return { message: "Saved." };
}
