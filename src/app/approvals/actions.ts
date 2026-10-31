"use server";
/**
 * Approve / reject / record a paper signature. Who may decide a step is decided by the approval engine (role or
 * named member, segregation of duties), not by a permission: any signed-in user can call these, and the engine
 * refuses everyone who isn't the step's approver.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, requireUser } from "@/lib/auth/session";
import { decideStep, recordPaperSignature } from "@/lib/approvals/server";
import { fail, formObject, idParam, optStr, zodErrors, type ActionState } from "@/lib/procurement/forms";

const schema = z.object({
  stepId: idParam("Approval step missing"),
  decision: z.enum(["APPROVED", "REJECTED"], { error: "Choose approve or reject" }),
  comment: optStr(2000),
  returnPath: optStr(300),
});

function refresh(returnPath?: string) {
  revalidatePath("/approvals");
  if (returnPath?.startsWith("/")) revalidatePath(returnPath.split("?")[0]);
}

export async function decideApprovalStep(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser();
  const p = schema.safeParse(formObject(fd));
  if (!p.success) return fail(...zodErrors(p.error));
  const res = await decideStep(p.data.stepId, p.data.decision, p.data.comment ?? null, me);
  if (!res.ok) return fail(res.error);
  refresh(p.data.returnPath);
  return { message: res.message };
}

export async function recordPaperSignatureAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("award.recommend");
  const p = z.object({ stepId: idParam("Approval step missing"), reference: optStr(200), returnPath: optStr(300) }).safeParse(formObject(fd));
  if (!p.success) return fail(...zodErrors(p.error));
  const res = await recordPaperSignature(p.data.stepId, me, p.data.reference ?? null);
  if (!res.ok) return fail(res.error);
  refresh(p.data.returnPath);
  return { message: res.message };
}
