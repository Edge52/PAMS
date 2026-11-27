"use server";
/** Wave 41: the biomedical on-call list (who is told again when a fault report isn't picked up). */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { biomedOnCall } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { zonedInstant } from "@/lib/format";
import { assignableUsers } from "@/lib/assets/work-order-server";
import { fail, formObject, idParam, type ActionState, zodFail } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";

const When = z.string({ error: "Enter the date and time" }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter the date and time");
const AddSchema = z.object({ facilityId: idParam("Hospital"), userId: idParam("Choose the person"), startsAt: When, endsAt: When });

export async function addOnCallAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("workorders.assign");
  const p = AddSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  await requireFacilityAccess(p.data.facilityId, me);
  const who = (await assignableUsers(p.data.facilityId)).find((u) => u.id === p.data.userId);
  if (!who) return fail("That person can't take jobs in this hospital: they need maintenance rights and access to it.");
  const at = (v: string) => zonedInstant(v.slice(0, 10), v.slice(11, 16));
  const startsAt = at(p.data.startsAt), endsAt = at(p.data.endsAt);
  if (endsAt <= startsAt) return fail("The end is before the start.");
  if (endsAt.getTime() - startsAt.getTime() > 31 * 86_400_000) return fail("One entry covers 31 days at most.");
  await db.insert(biomedOnCall).values({ facilityId: p.data.facilityId, userId: who.id, startsAt, endsAt, setByName: me.name });
  await logActivity("facility", p.data.facilityId, "on_call_added", `${who.name} on call from ${p.data.startsAt.replace("T", " ")} to ${p.data.endsAt.replace("T", " ")}`, me.name);
  revalidatePath("/assets/work-orders/on-call");
  return { message: `${who.name} is on the on-call list.` };
}

export async function removeOnCallAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("workorders.assign");
  const p = z.object({ entryId: idParam("Entry missing") }).safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const [e] = await db.select().from(biomedOnCall).where(eq(biomedOnCall.id, p.data.entryId));
  if (!e) return fail("This entry was already removed.");
  await requireFacilityAccess(e.facilityId, me);
  await db.delete(biomedOnCall).where(and(eq(biomedOnCall.id, e.id), eq(biomedOnCall.facilityId, e.facilityId)));
  await logActivity("facility", e.facilityId, "on_call_removed", "On-call entry removed", me.name);
  revalidatePath("/assets/work-orders/on-call");
  return { message: "Removed from the on-call list." };
}
