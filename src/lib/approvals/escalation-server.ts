import "server-only";
/**
 * Wave 41: approval steps waiting too long (working days skip weekends and public holidays, wave 43). Runs with the hourly alert job. A step waiting the set number of working
 * days (per entity, default 3) reminds its approvers again; at twice that it goes to the director (the
 * administrators when the step is the director's). Rules in ./escalation.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests, approvalSteps } from "@/db/schema";
import { todayISO } from "@/lib/format";
import { notifyUsers, usersWithRole } from "@/lib/notifications";
import { isMissingTable } from "@/lib/notifications/prefs-server";
import { getSetting } from "@/lib/settings";
import { activeDelegations, saveEscalation, trackingFor } from "./delegation-server";
import { holidayDatesBy } from "../holidays-server";
import { workingDaysBetween } from "../working-days";
import { escalationDays, escalationLevelDue, escalationRole, withDeputies } from "./escalation";
import { awardExcluded, stepRecipients } from "./server";

export async function runApprovalEscalations(now = new Date()): Promise<number> {
  try {
    const rows = await db.select({ step: approvalSteps, request: approvalRequests }).from(approvalSteps)
      .innerJoin(approvalRequests, eq(approvalRequests.id, approvalSteps.requestId))
      .where(and(eq(approvalSteps.status, "PENDING"), eq(approvalRequests.status, "PENDING")))
      .orderBy(asc(approvalSteps.id)).limit(500);
    if (!rows.length) return 0;
    const setting = await getSetting("approvalEscalationDays");
    const tracking = await trackingFor(rows.map((r) => r.step.id));
    const today = todayISO(now);
    const dels = await activeDelegations(today);
    const sinceOf = (r: (typeof rows)[number]) => tracking.get(r.step.id)?.pendingSince ?? r.request.requestedAt;
    // Wave 43: public holidays don't count as days waited.
    const hols = await holidayDatesBy(rows.map((r) => r.request.facilityId), rows.map((r) => todayISO(sinceOf(r))).sort()[0] ?? today, today);
    let created = 0;
    for (const { step, request } of rows) {
      const t = tracking.get(step.id);
      const since = t?.pendingSince ?? request.requestedAt;
      const due = escalationLevelDue(workingDaysBetween(todayISO(since), today, hols(request.facilityId)), escalationDays(request.entity, setting));
      const level = t?.level ?? 0;
      if (due <= level) continue;
      const waited = `Waiting since ${todayISO(since)}`;
      if (level < 1) {
        const { ids } = await stepRecipients(request, step, await awardExcluded(request), today);
        created += await notifyUsers(ids, { kind: "approval_reminder", title: `Still waiting for your approval: ${request.title}`, body: `${step.label}. ${waited}.`, href: request.href, dedupeKey: `approval_reminder:${step.id}` });
      }
      if (due >= 2) {
        const role = escalationRole(step.approverRole);
        const ids = withDeputies(await usersWithRole(role, request.facilityId), dels, today).filter((u) => u !== request.requestedById);
        created += await notifyUsers(ids, { kind: "approval_escalated", title: `Approval overdue: ${request.title}`, body: `${step.label} has not been decided. ${waited}.`, href: "/approvals", dedupeKey: `approval_escalated:${step.id}` });
      }
      await saveEscalation(step.id, due, since, now);
    }
    return created;
  } catch (e) {
    if (!isMissingTable(e)) console.error("[approvals] escalation run failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}
