import { describe, expect, it } from "vitest";
import {
  actualFor, checkPlan, cleanMinDays, DEFAULT_MIN_DAYS, knownActuals, methodOf, needsJustification, overdueStepAlerts,
  stepsFor, stepState, stateLabel, suggestPlan,
} from "./timetable";
import { addendumLabel, answerWarnings, checkAddendum, nextAddendumNumber, registerCounts } from "./clarifications";

const base = { method: "PUBLIC_TENDER" as const, minDays: DEFAULT_MIN_DAYS, complaintDays: 7, twoEnvelope: true };

describe("methods", () => {
  it("reads unknown or blank as a public tender, which needs no justification", () => {
    expect(methodOf(null)).toBe("PUBLIC_TENDER");
    expect(methodOf("NOPE")).toBe("PUBLIC_TENDER");
    expect(methodOf("DIRECT_AGREEMENT")).toBe("DIRECT_AGREEMENT");
    expect(needsJustification("PUBLIC_TENDER")).toBe(false);
    expect(needsJustification("LIMITED_PRACTICE")).toBe(true);
  });
  it("cleans the minimum-days setting defensively", () => {
    expect(cleanMinDays(null)).toEqual(DEFAULT_MIN_DAYS);
    const c = cleanMinDays({ PUBLIC_TENDER: "45", LOCAL_TENDER: -3, LIMITED_TENDER: 9999, EXTRA: 4, DIRECT_AGREEMENT: 2.6 });
    expect(c.PUBLIC_TENDER).toBe(45);
    expect(c.LOCAL_TENDER).toBe(DEFAULT_MIN_DAYS.LOCAL_TENDER);
    expect(c.LIMITED_TENDER).toBe(DEFAULT_MIN_DAYS.LIMITED_TENDER);
    expect(c.DIRECT_AGREEMENT).toBe(3);
    expect("EXTRA" in c).toBe(false);
  });
});

describe("suggested plan", () => {
  it("follows the minimum period and keeps dates already entered", () => {
    const p = suggestPlan({ ...base, announcement: "2026-01-01" });
    expect(p.SUBMISSION).toBe("2026-01-31");
    expect(p.TECHNICAL_OPENING).toBe("2026-01-31");
    expect(p.CLARIFICATION_DEADLINE).toBe("2026-01-24");
    expect(p.FINANCIAL_OPENING).toBe("2026-02-14");
    expect(p.AWARD_DECISION).toBe("2026-03-07");
    expect(p.STANDSTILL_END).toBe("2026-03-14");
    expect(p.CONTRACT_SIGNATURE).toBe("2026-03-24");
    const kept = suggestPlan({ ...base, twoEnvelope: false, announcement: "2026-01-01", current: { SUBMISSION: "2026-02-10" } });
    expect(kept.SUBMISSION).toBe("2026-02-10");
    expect(kept.FINANCIAL_OPENING).toBeNull();
    expect(kept.AWARD_DECISION).toBe("2026-03-03");
    expect(checkPlan(p, base)).toEqual([]);
  });
  it("never puts the last day for questions before the announcement", () => {
    const p = suggestPlan({ ...base, method: "DIRECT_AGREEMENT", announcement: "2026-01-01" });
    expect(p.CLARIFICATION_DEADLINE).toBe("2026-01-01");
  });
});

describe("plan checks", () => {
  it("flags a submission date shorter than the method's minimum", () => {
    const probs = checkPlan({ ANNOUNCEMENT: "2026-01-01", SUBMISSION: "2026-01-20" }, base);
    expect(probs).toHaveLength(1);
    expect(probs[0].step).toBe("SUBMISSION");
    expect(probs[0].text).toContain("Only 19 days");
    expect(probs[0].text).toContain("30 days");
    expect(checkPlan({ ANNOUNCEMENT: "2026-01-01", SUBMISSION: "2026-01-20" }, { ...base, method: "LIMITED_TENDER" })).toEqual([]);
  });
  it("flags steps out of order, late questions and a short complaint period", () => {
    const probs = checkPlan({
      ANNOUNCEMENT: "2026-01-01", CLARIFICATION_DEADLINE: "2026-02-01", SUBMISSION: "2026-02-03", TECHNICAL_OPENING: "2026-02-03",
      AWARD_DECISION: "2026-03-01", STANDSTILL_END: "2026-03-04", CONTRACT_SIGNATURE: "2026-03-02",
    }, base);
    expect(probs.map((p) => p.step).sort()).toEqual(["CLARIFICATION_DEADLINE", "CONTRACT_SIGNATURE", "STANDSTILL_END"]);
  });
  it("ignores the financial opening in a single-envelope tender", () => {
    expect(stepsFor(false)).not.toContain("FINANCIAL_OPENING");
    expect(checkPlan({ TECHNICAL_OPENING: "2026-02-01", FINANCIAL_OPENING: "2026-01-01" }, { ...base, twoEnvelope: false })).toEqual([]);
    expect(checkPlan({ TECHNICAL_OPENING: "2026-02-01", FINANCIAL_OPENING: "2026-01-01" }, base)).toHaveLength(1);
  });
});

describe("step state", () => {
  const today = "2026-05-10";
  it("compares the actual with the plan, or the plan with today", () => {
    expect(stepState("2026-05-01", "2026-05-01", today)).toEqual({ kind: "on_time" });
    expect(stepState("2026-05-01", "2026-04-28", today)).toEqual({ kind: "on_time" });
    expect(stepState("2026-05-01", "2026-05-04", today)).toEqual({ kind: "late", days: 3 });
    expect(stepState(null, "2026-05-04", today)).toEqual({ kind: "done" });
    expect(stepState("2026-05-08", null, today)).toEqual({ kind: "overdue", days: 2 });
    expect(stepState("2026-05-10", null, today)).toEqual({ kind: "due_today" });
    expect(stepState("2026-05-11", null, today)).toEqual({ kind: "upcoming", days: 1 });
    expect(stepState(null, null, today)).toEqual({ kind: "not_planned" });
    expect(stateLabel({ kind: "late", days: 1 })).toEqual({ text: "Late by 1 day", tone: "warn" });
  });
});

describe("actual dates from the app", () => {
  const today = "2026-05-10";
  it("takes RFQ, envelope, award and order dates", () => {
    const k = knownActuals({
      technicalOpenedAt: new Date("2026-04-01T22:30:00Z"), // 2 Apr in Cairo
      financialOpenedAt: null,
      rfqs: [
        { status: "ISSUED", issueDate: "2026-03-01", closingDate: "2026-03-31" },
        { status: "CLOSED", issueDate: "2026-03-05", closingDate: "2026-04-01" },
        { status: "DRAFT", issueDate: "2026-02-01", closingDate: "2026-02-10" },
      ],
      awards: [{ awardApprovedOn: "2026-05-01", complaintUntil: "2026-05-08" }],
      pos: [{ status: "DRAFT", issueDate: "2026-05-02" }, { status: "ISSUED", issueDate: "2026-05-09" }],
    }, today);
    expect(k).toEqual({
      ANNOUNCEMENT: "2026-03-01", SUBMISSION: "2026-04-01", TECHNICAL_OPENING: "2026-04-02",
      AWARD_DECISION: "2026-05-01", STANDSTILL_END: "2026-05-08", CONTRACT_SIGNATURE: "2026-05-09",
    });
  });
  it("leaves a closing date or complaint period still to come as not done", () => {
    const k = knownActuals({ technicalOpenedAt: null, financialOpenedAt: null, rfqs: [{ status: "ISSUED", issueDate: "2026-05-01", closingDate: "2026-05-20" }],
      awards: [{ awardApprovedOn: "2026-05-05", complaintUntil: "2026-05-12" }], pos: [] }, today);
    expect(k.SUBMISSION).toBeUndefined();
    expect(k.STANDSTILL_END).toBeUndefined();
    expect(actualFor("SUBMISSION", "2026-05-03", k)).toEqual({ date: "2026-05-03", fromApp: false });
    expect(actualFor("ANNOUNCEMENT", "2026-04-30", k)).toEqual({ date: "2026-05-01", fromApp: true });
  });
});

describe("overdue alerts", () => {
  const today = "2026-05-10";
  const row = { projectId: 4, code: "T-4", facilityId: 1, twoEnvelope: false, step: "SUBMISSION", plannedDate: "2026-05-08", actualDate: null };
  it("alerts once per step and planned date, never for a step the app has recorded", () => {
    const a = overdueStepAlerts([row], new Map(), today);
    expect(a).toHaveLength(1);
    expect(a[0].n.kind).toBe("tender_step_overdue");
    expect(a[0].n.dedupeKey).toBe("tender_step_overdue:4:SUBMISSION:2026-05-08");
    expect(a[0].n.href).toBe("/procurement/4?tab=tender");
    expect(overdueStepAlerts([{ ...row, actualDate: "2026-05-09" }], new Map(), today)).toHaveLength(0);
    expect(overdueStepAlerts([row], new Map([[4, { SUBMISSION: "2026-05-09" }]]), today)).toHaveLength(0);
    expect(overdueStepAlerts([{ ...row, plannedDate: today }], new Map(), today)).toHaveLength(0);
    expect(overdueStepAlerts([{ ...row, step: "FINANCIAL_OPENING" }], new Map(), today)).toHaveLength(0);
    expect(overdueStepAlerts([{ ...row, step: "BOGUS" }], new Map(), today)).toHaveLength(0);
  });
});

describe("addenda", () => {
  it("numbers addenda after the highest so far", () => {
    expect(nextAddendumNumber([])).toBe(1);
    expect(nextAddendumNumber([1, 3, 2])).toBe(4);
    expect(addendumLabel(2)).toBe("Addendum 2");
  });
  const a = { issuedOn: "2026-05-01", extendsDeadline: false, newClosingDate: null, currentClosingDate: "2026-05-20", technicalOpened: false };
  it("extends the deadline only to a later date", () => {
    expect(checkAddendum(a)).toEqual({ errors: [], warnings: [], closingAfter: "2026-05-20" });
    expect(checkAddendum({ ...a, extendsDeadline: true }).errors).toEqual(["Enter the new closing date."]);
    expect(checkAddendum({ ...a, extendsDeadline: true, newClosingDate: "2026-05-20" }).errors[0]).toContain("after the current one");
    expect(checkAddendum({ ...a, extendsDeadline: true, newClosingDate: "2026-06-01" })).toEqual({ errors: [], warnings: [], closingAfter: "2026-06-01" });
    expect(checkAddendum({ ...a, currentClosingDate: null, extendsDeadline: true, newClosingDate: "2026-04-01" }).errors[0]).toContain("after the addendum date");
  });
  it("refuses changes after the technical opening and warns when fewer than 7 days remain", () => {
    expect(checkAddendum({ ...a, technicalOpened: true }).errors[0]).toContain("art. 19");
    const w = checkAddendum({ ...a, issuedOn: "2026-05-16" });
    expect(w.errors).toEqual([]);
    expect(w.warnings[0]).toContain("Only 4 days");
    expect(checkAddendum({ ...a, issuedOn: "2026-05-16", extendsDeadline: true, newClosingDate: "2026-05-30" }).warnings).toEqual([]);
  });
});

describe("answers", () => {
  it("warns when an answer is slow or too close to the closing date", () => {
    expect(answerWarnings({ receivedOn: "2026-05-01", sentOn: "2026-05-03", closingDate: "2026-05-20" })).toEqual([]);
    expect(answerWarnings({ receivedOn: "2026-05-01", sentOn: "2026-05-06", closingDate: "2026-05-20" })[0]).toContain("5 days after");
    expect(answerWarnings({ receivedOn: "2026-05-10", sentOn: "2026-05-15", closingDate: "2026-05-20" })).toHaveLength(2);
  });
  it("counts questions, sent answers and open ones", () => {
    expect(registerCounts([{ answer: "x", sentOn: "2026-01-01" }, { answer: "y", sentOn: null }, { answer: null, sentOn: null }]))
      .toEqual({ questions: 3, sent: 1, open: 2 });
  });
});

describe("notice to all bidders", () => {
  it("lists addenda and answers without naming suppliers", async () => {
    const { noticeText } = await import("./clarifications");
    const n = noticeText({
      rfqNumber: "RFQ-2026-0001", title: "ICU monitors", projectCode: "T-1", closingDate: "2026-06-01", formatDate: (d) => d,
      answers: [{ question: "Is a central station needed?", answer: "Yes, one per ward.", sentOn: "2026-05-02" }],
      addenda: [{ number: 1, issuedOn: "2026-05-03", summary: "Item 4 quantity 6 → 8.", extendsDeadline: true, newClosingDate: "2026-06-01" }],
    });
    expect(n.subject).toBe("RFQ-2026-0001: clarifications and addenda");
    expect(n.text).toContain("Addendum 1 (2026-05-03): Item 4 quantity 6 → 8.");
    expect(n.text).toContain("extended to 2026-06-01");
    expect(n.text).toContain("Q1. Is a central station needed?\nA1. Yes, one per ward.");
  });
});
