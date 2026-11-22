"use server";
/**
 * Clarifications and addenda register (wave 37, Law 182/2018 art. 19). Rules are pure in
 * src/lib/procurement/clarifications.ts.
 */
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { projects, rfqs, rfqSuppliers, suppliers, tenderAddenda, tenderClarifications } from "@/db/schema";
import { requireFacilityAccess, requirePermission, type CurrentUser } from "@/lib/auth/session";
import { formatDate, todayISO } from "@/lib/format";
import { emailStatus, sendMail } from "@/lib/notifications/email";
import { addendumLabel, answerWarnings, checkAddendum, nextAddendumNumber, noticeText } from "@/lib/procurement/clarifications";
import { fail, formObject, idParam, isUniqueViolation, optDate, reqDate, reqStr, type ActionState, zodFail } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";

async function rfqFor(rfqId: number, me: CurrentUser) {
  const [row] = await db.select({ rfq: rfqs, project: projects }).from(rfqs).innerJoin(projects, eq(projects.id, rfqs.projectId)).where(eq(rfqs.id, rfqId));
  if (!row) return null;
  await requireFacilityAccess(row.project.facilityId, me);
  return row;
}

async function questionFor(id: number, me: CurrentUser) {
  const [q] = Number.isInteger(id) && id > 0 ? await db.select().from(tenderClarifications).where(eq(tenderClarifications.id, id)) : [];
  if (!q) return null;
  const r = await rfqFor(q.rfqId, me);
  return r ? { q, ...r } : null;
}

const paths = (rfqId: number, projectId: number) => { revalidatePath(`/procurement/rfqs/${rfqId}`); revalidatePath(`/procurement/${projectId}`); };
const blank = (v: unknown) => (v === "" ? undefined : v);

export async function addQuestionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const parsed = z.object({
    rfqId: idParam("RFQ missing"),
    supplierId: z.preprocess(blank, z.coerce.number().int().positive().optional()),
    receivedOn: reqDate("Enter the date the question was received"),
    question: reqStr("Enter the question", 4000),
  }).safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const d = parsed.data;
  const r = await rfqFor(d.rfqId, me);
  if (!r) return fail("This RFQ no longer exists.");
  if (d.receivedOn > todayISO()) return { errors: ["The received date can't be in the future."], fields: { receivedOn: "Can't be after today." } };
  let who = "a bidder";
  if (d.supplierId) {
    const [inv] = await db.select({ name: suppliers.name }).from(rfqSuppliers).innerJoin(suppliers, eq(suppliers.id, rfqSuppliers.supplierId))
      .where(and(eq(rfqSuppliers.rfqId, d.rfqId), eq(rfqSuppliers.supplierId, d.supplierId)));
    if (!inv) return { errors: ["Choose a supplier invited to this RFQ."], fields: { supplierId: "Not invited to this RFQ." } };
    who = inv.name;
  }
  await db.insert(tenderClarifications).values({ rfqId: d.rfqId, supplierId: d.supplierId ?? null, receivedOn: d.receivedOn, question: d.question.trim() });
  await logActivity("rfq", d.rfqId, "clarification", `Question from ${who} recorded (received ${formatDate(d.receivedOn)})`, me.name);
  paths(d.rfqId, r.project.id);
  return { message: "Question recorded." };
}

export async function answerQuestionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const parsed = z.object({
    id: idParam("Question missing"),
    answer: reqStr("Enter the answer", 4000),
    sentOn: optDate("Enter the date it was sent as a date"),
  }).safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const d = parsed.data;
  const x = await questionFor(d.id, me);
  if (!x) return fail("This question no longer exists.");
  if (d.sentOn && d.sentOn > todayISO()) return { errors: ["The sent date can't be in the future."], fields: { sentOn: "Can't be after today." } };
  if (x.project.technicalOpenedAt && !x.q.sentOn && d.sentOn) return fail("The technical envelopes are open: answers can't go to bidders now (art. 19).");
  await db.update(tenderClarifications).set({ answer: d.answer.trim(), sentOn: d.sentOn ?? null }).where(eq(tenderClarifications.id, d.id));
  await logActivity("rfq", x.rfq.id, "clarification", d.sentOn ? `Answer sent to all bidders on ${formatDate(d.sentOn)}` : "Answer drafted (not sent yet)", me.name);
  paths(x.rfq.id, x.project.id);
  const warn = d.sentOn ? answerWarnings({ receivedOn: x.q.receivedOn, sentOn: d.sentOn, closingDate: x.rfq.closingDate }) : [];
  return { message: `Answer saved.${warn.length ? ` Check: ${warn.join(" ")}` : ""}` };
}

export async function deleteQuestionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const x = await questionFor(Number(fd.get("id")), me);
  if (!x) return fail("This question no longer exists.");
  if (x.q.sentOn) return fail("This answer has gone to the bidders, so it stays on the register.");
  await db.delete(tenderClarifications).where(eq(tenderClarifications.id, x.q.id));
  await logActivity("rfq", x.rfq.id, "clarification", `Question received ${formatDate(x.q.receivedOn)} removed from the register`, me.name);
  paths(x.rfq.id, x.project.id);
  return { message: "Question removed." };
}

export async function addAddendumAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const parsed = z.object({
    rfqId: idParam("RFQ missing"),
    issuedOn: reqDate("Enter the addendum date"),
    summary: reqStr("Say what the addendum changes", 4000),
    newClosingDate: optDate("Enter the new closing date as a date"),
  }).safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const d = parsed.data;
  const extendsDeadline = fd.get("extendsDeadline") === "on";
  const r = await rfqFor(d.rfqId, me);
  if (!r) return fail("This RFQ no longer exists.");
  if (r.rfq.status === "CANCELLED") return fail("This RFQ is cancelled.");
  const check = checkAddendum({
    issuedOn: d.issuedOn, extendsDeadline, newClosingDate: d.newClosingDate ?? null, currentClosingDate: r.rfq.closingDate,
    technicalOpened: !!r.project.technicalOpenedAt,
  });
  if (check.errors.length) return { errors: check.errors, ...(extendsDeadline && !d.newClosingDate ? { fields: { newClosingDate: "Enter the new closing date." } } : {}) };
  const existing = await db.select({ n: tenderAddenda.number }).from(tenderAddenda).where(eq(tenderAddenda.rfqId, d.rfqId));
  const number = nextAddendumNumber(existing.map((e) => e.n));
  const old = r.rfq.closingDate;
  const moveProject = extendsDeadline && (!r.project.submissionDeadline || r.project.submissionDeadline === old);
  try {
    await db.transaction(async (tx) => {
      await tx.insert(tenderAddenda).values({
        rfqId: d.rfqId, number, issuedOn: d.issuedOn, summary: d.summary.trim(), extendsDeadline,
        previousClosingDate: extendsDeadline ? old : null, newClosingDate: extendsDeadline ? d.newClosingDate! : null,
      });
      await logActivity("rfq", d.rfqId, "addendum", `${addendumLabel(number)} issued ${formatDate(d.issuedOn)}`, me.name, tx);
      if (extendsDeadline) {
        await tx.update(rfqs).set({ closingDate: d.newClosingDate! }).where(eq(rfqs.id, d.rfqId));
        await logActivity("rfq", d.rfqId, "deadline_extended", `Closing date ${old ? formatDate(old) : "not set"} → ${formatDate(d.newClosingDate!)} by ${addendumLabel(number)}`, me.name, tx);
        if (moveProject) {
          await tx.update(projects).set({ submissionDeadline: d.newClosingDate! }).where(eq(projects.id, r.project.id));
          await logActivity("project", r.project.id, "deadline_extended", `Submission deadline moved to ${formatDate(d.newClosingDate!)} by ${r.rfq.number} ${addendumLabel(number)}`, me.name, tx);
        }
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("Someone issued an addendum at the same moment. Reload and try again.");
    throw e;
  }
  paths(d.rfqId, r.project.id);
  const ext = extendsDeadline ? ` The closing date is now ${formatDate(d.newClosingDate!)}.` : "";
  return { message: `${addendumLabel(number)} recorded.${ext}${check.warnings.length ? ` Check: ${check.warnings.join(" ")}` : ""}` };
}

/** Email the notice to every invited supplier, one message each (nobody sees who else was invited or who asked). */
export async function emailNoticeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const r = await rfqFor(Number(fd.get("rfqId")), me);
  if (!r) return fail("This RFQ no longer exists.");
  if (!(await emailStatus()).active) return fail("Email isn't switched on. Print the notice and send it instead.");
  const [answers, addenda, invited] = await Promise.all([
    db.select().from(tenderClarifications).where(and(eq(tenderClarifications.rfqId, r.rfq.id), isNotNull(tenderClarifications.answer), isNotNull(tenderClarifications.sentOn)))
      .orderBy(asc(tenderClarifications.receivedOn), asc(tenderClarifications.id)),
    db.select().from(tenderAddenda).where(eq(tenderAddenda.rfqId, r.rfq.id)).orderBy(asc(tenderAddenda.number)),
    db.select({ name: suppliers.name, email: suppliers.email }).from(rfqSuppliers).innerJoin(suppliers, eq(suppliers.id, rfqSuppliers.supplierId)).where(eq(rfqSuppliers.rfqId, r.rfq.id)),
  ]);
  if (!answers.length && !addenda.length) return fail("Nothing to send yet: mark answers as sent or record an addendum first.");
  const to = invited.filter((i) => i.email);
  if (!to.length) return fail("None of the invited suppliers has an email address.");
  const n = noticeText({
    rfqNumber: r.rfq.number, title: r.rfq.title, projectCode: r.project.code, closingDate: r.rfq.closingDate, formatDate,
    answers: answers.map((a) => ({ question: a.question, answer: a.answer!, sentOn: a.sentOn })),
    addenda: addenda.map((a) => ({ number: a.number, issuedOn: a.issuedOn, summary: a.summary, extendsDeadline: a.extendsDeadline, newClosingDate: a.newClosingDate })),
  });
  let sent = 0;
  const failed: string[] = [];
  for (const s of to) {
    try { await sendMail(s.email!, n.subject, n.text); sent++; } catch (e) { console.error("[clarifications] email failed:", e); failed.push(s.name); }
  }
  await logActivity("rfq", r.rfq.id, "notice_emailed", `Clarifications notice emailed to ${sent} invited supplier${sent === 1 ? "" : "s"}${failed.length ? `; failed for ${failed.join(", ")}` : ""}`, me.name);
  revalidatePath(`/procurement/rfqs/${r.rfq.id}`);
  const missing = invited.length - to.length;
  return failed.length
    ? { errors: [`Sent to ${sent}; failed for ${failed.join(", ")}.`] }
    : { message: `Sent to ${sent} supplier${sent === 1 ? "" : "s"}.${missing ? ` ${missing} ha${missing === 1 ? "s" : "ve"} no email address: print the notice for them.` : ""}` };
}
