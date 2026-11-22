/**
 * Clarifications and addenda register (wave 37, Law 182/2018 art. 19). Pure: safe on server, client and in tests.
 *
 * Art. 19: amendments and clarifications are notified to everyone who bought the booklet within 3 days; at least 7
 * days must remain between that notice and the technical opening; nothing may change after the technical opening.
 */
import { ANSWER_LEAD_DAYS } from "./timetable";

export const NOTIFY_WITHIN_DAYS = 3;

const days = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000);

export function nextAddendumNumber(existing: number[]): number {
  return existing.reduce((m, n) => (n > m ? n : m), 0) + 1;
}

export const addendumLabel = (n: number) => `Addendum ${n}`;

/**
 * Checks for a new addendum. Errors stop it; warnings are shown with it.
 * - nothing after the technical opening (art. 19);
 * - an extension needs a new closing date after the current one;
 * - fewer than 7 days between the addendum and the closing date (the technical opening) is a warning.
 */
export function checkAddendum(o: {
  issuedOn: string; extendsDeadline: boolean; newClosingDate: string | null; currentClosingDate: string | null;
  technicalOpened: boolean;
}): { errors: string[]; warnings: string[]; closingAfter: string | null } {
  const errors: string[] = [], warnings: string[] = [];
  if (o.technicalOpened) errors.push("The technical envelopes are open: the tender documents can't change now (art. 19).");
  let closingAfter = o.currentClosingDate;
  if (o.extendsDeadline) {
    if (!o.newClosingDate) errors.push("Enter the new closing date.");
    else if (o.currentClosingDate && o.newClosingDate <= o.currentClosingDate) errors.push("The new closing date must be after the current one.");
    else if (o.newClosingDate < o.issuedOn) errors.push("The new closing date must be after the addendum date.");
    else closingAfter = o.newClosingDate;
  }
  if (closingAfter && errors.length === 0 && days(o.issuedOn, closingAfter) < ANSWER_LEAD_DAYS) {
    warnings.push(`Only ${days(o.issuedOn, closingAfter)} days between this addendum and the closing date. The law asks for at least ${ANSWER_LEAD_DAYS} before the technical opening (art. 19): consider extending the deadline.`);
  }
  return { errors, warnings, closingAfter };
}

/** Warnings for an answer sent on `sentOn`: late against the question or too close to the closing date. */
export function answerWarnings(o: { receivedOn: string; sentOn: string; closingDate: string | null }): string[] {
  const out: string[] = [];
  if (days(o.receivedOn, o.sentOn) > NOTIFY_WITHIN_DAYS) out.push(`Sent ${days(o.receivedOn, o.sentOn)} days after the question (art. 19 asks for ${NOTIFY_WITHIN_DAYS}).`);
  if (o.closingDate && days(o.sentOn, o.closingDate) < ANSWER_LEAD_DAYS) out.push(`Less than ${ANSWER_LEAD_DAYS} days before the closing date (art. 19).`);
  if (o.sentOn < o.receivedOn) out.push("Sent before the question was received: check the dates.");
  return out;
}

export type RegisterRow = { answer: string | null; sentOn: string | null };

/** Counts for the project and RFQ: questions, answered and sent, still open. */
export function registerCounts(rows: RegisterRow[]) {
  const sent = rows.filter((r) => r.answer && r.sentOn).length;
  return { questions: rows.length, sent, open: rows.length - sent };
}

export type NoticeInput = {
  rfqNumber: string; title: string; projectCode: string; closingDate: string | null;
  answers: { question: string; answer: string; sentOn: string | null }[];
  addenda: { number: number; issuedOn: string; summary: string; extendsDeadline: boolean; newClosingDate: string | null }[];
  formatDate: (iso: string) => string;
};

/**
 * Plain-text notice to every invited bidder: answers and addenda, never who asked (the email and the printable page
 * say the same). Questions are numbered in the order they were received.
 */
export function noticeText(n: NoticeInput): { subject: string; text: string } {
  const lines = [`Clarifications and addenda: ${n.rfqNumber} — ${n.title} (${n.projectCode})`, ""];
  lines.push("This notice goes to every invited bidder. It does not say who asked each question.", "");
  if (n.closingDate) lines.push(`Closing date: ${n.formatDate(n.closingDate)}`, "");
  if (n.addenda.length) {
    lines.push("Addenda");
    for (const a of n.addenda) {
      lines.push(`${addendumLabel(a.number)} (${n.formatDate(a.issuedOn)}): ${a.summary}`);
      if (a.extendsDeadline && a.newClosingDate) lines.push(`  The closing date is extended to ${n.formatDate(a.newClosingDate)}.`);
    }
    lines.push("");
  }
  if (n.answers.length) {
    lines.push("Questions and answers");
    n.answers.forEach((x, i) => { lines.push(`Q${i + 1}. ${x.question}`, `A${i + 1}. ${x.answer}`, ""); });
  }
  if (!n.addenda.length && !n.answers.length) lines.push("No clarifications or addenda yet.");
  return { subject: `${n.rfqNumber}: clarifications and addenda`.slice(0, 200), text: lines.join("\n").trimEnd() + "\n" };
}
