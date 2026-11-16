"use server";
/** Device network and security details (wave 25). Needs `assets.edit`. */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { assets, assetSecurity } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formObject, isoDate, oneOf, reqId, text } from "@/lib/assets/forms";
import { addressProblem, CONNECTIONS, REMOTE, tidyMac, TRI } from "@/lib/assets/device-security";
import { diff } from "@/lib/audit-diff";
import { fail, zodFail, type ActionState } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";
import { todayISO } from "@/lib/format";

const Schema = z.object({
  assetId: reqId("Device"),
  connection: oneOf("Connection", CONNECTIONS), ipAddress: text(45), macAddress: text(17), hostname: text(120), networkZone: text(80),
  operatingSystem: text(120), osSupportEnds: isoDate("Support end date"),
  storesPatientData: oneOf("Stores patient data", TRI), sendsPatientData: oneOf("Sends patient data", TRI), encrypted: oneOf("Encrypted", TRI),
  antiMalware: oneOf("Malware protection", TRI), defaultPasswordsChanged: oneOf("Factory passwords changed", TRI), remoteAccess: oneOf("Remote access", REMOTE),
  lastPatchedOn: isoDate("Last security update"), mds2Ref: text(300), notes: text(2000),
});

export async function saveDeviceSecurityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const p = Schema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const { assetId, ...d } = p.data;
  const [a] = await db.select({ id: assets.id, facilityId: assets.facilityId }).from(assets).where(eq(assets.id, assetId));
  if (!a) return fail("That device is not in the register.");
  await requireFacilityAccess(a.facilityId, me);
  const bad = addressProblem(d.ipAddress, d.macAddress);
  if (bad) return { errors: Object.values(bad), fields: bad };
  const today = todayISO();
  if (d.lastPatchedOn && d.lastPatchedOn > today) return { errors: ["The last security update can't be in the future."], fields: { lastPatchedOn: "This date is in the future." } };
  const off = d.connection === "NONE";
  const values = {
    connection: d.connection ?? "NONE", ipAddress: off ? null : d.ipAddress ?? null, macAddress: d.macAddress ? tidyMac(d.macAddress) : null,
    hostname: off ? null : d.hostname ?? null, networkZone: off ? null : d.networkZone ?? null,
    operatingSystem: d.operatingSystem ?? null, osSupportEnds: d.osSupportEnds ?? null,
    storesPatientData: d.storesPatientData ?? "UNKNOWN", sendsPatientData: d.sendsPatientData ?? "UNKNOWN", encrypted: d.encrypted ?? "UNKNOWN",
    antiMalware: d.antiMalware ?? "UNKNOWN", defaultPasswordsChanged: d.defaultPasswordsChanged ?? "UNKNOWN", remoteAccess: d.remoteAccess ?? "NONE",
    lastPatchedOn: d.lastPatchedOn ?? null, mds2OnFile: fd.get("mds2OnFile") === "on", mds2Ref: d.mds2Ref ?? null, notes: d.notes ?? null,
    // Saving the form counts as a review, by the person who saved it.
    reviewedOn: today, reviewedByName: me.name,
  };
  const [before] = await db.select().from(assetSecurity).where(eq(assetSecurity.assetId, assetId));
  if (before) await db.update(assetSecurity).set(values).where(eq(assetSecurity.id, before.id));
  else await db.insert(assetSecurity).values({ assetId, ...values });
  const { reviewedOn: _r, reviewedByName: _n, ...compared } = values;
  void _r; void _n;
  await logActivity("asset", assetId, "updated", before ? "Network and security details reviewed" : "Network and security details recorded", me.name, db, before ? diff(before, compared) : null);
  revalidatePath(`/assets/${assetId}`); revalidatePath("/assets/security");
  return redirect(`/assets/${assetId}?notice=${encodeURIComponent("Network and security details saved.")}#device-security`);
}
