/**
 * Wave 37: addenda move the RFQ closing date, numbering per RFQ, nothing after the technical opening, timetable
 * saving keeps the app's dates, overdue steps alert. Real actions against in-memory PGlite with the real migrations.
 *
 * Needs the migration that creates the wave 37 tables: skipped until drizzle/ has one (the lead generates it on merge).
 */
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";

const folder = path.resolve(__dirname, "..", "..", "..", "drizzle");
const ready = fs.readdirSync(folder).some((f) => f.endsWith(".sql") && fs.readFileSync(path.join(folder, f), "utf8").includes("\"tender_addenda\""));

const h = vi.hoisted(() => ({ d: null as unknown as DB, log: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/format", () => import("../format"));
vi.mock("@/lib/procurement/forms", () => import("./forms"));
vi.mock("@/lib/procurement/clarifications", () => import("./clarifications"));
vi.mock("@/lib/procurement/timetable", () => import("./timetable"));
vi.mock("@/lib/procurement/timetable-server", () => import("./timetable-server"));
vi.mock("@/lib/server-utils", () => ({ logActivity: async (_t: string, _id: number, action: string, summary: string) => { h.log.push(`${action}: ${summary}`); } }));
vi.mock("@/lib/settings", () => ({ getSettings: async () => ({ complaintDays: 7, tenderMinDays: {} }), getSetting: async () => ({}) }));
vi.mock("@/lib/auth/session", () => ({ requirePermission: async () => ({ id: 1, name: "Tester", role: "ADMIN" }), requireFacilityAccess: async () => {} }));
vi.mock("@/lib/notifications/email", () => ({ emailStatus: async () => ({ active: false }), sendMail: async () => {} }));

const { projects, rfqs, suppliers, rfqSuppliers, tenderAddenda, tenderTimetableSteps } = schema;
let client: PGlite; let d: DB;
let projectId = 0, rfqId = 0;
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

describe.skipIf(!ready)("tender file (wave 37)", () => {
  beforeAll(async () => {
    client = new PGlite();
    d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
    h.d = d;
    await migrate(d as never, { migrationsFolder: folder });
    [{ id: projectId }] = await d.insert(projects).values({ code: "T-37", title: "CT tender", submissionDeadline: "2030-03-01", procurementMethod: "PUBLIC_TENDER" }).returning({ id: projects.id });
    [{ id: rfqId }] = await d.insert(rfqs).values({ projectId, number: "RFQ-T-1", title: "CT", status: "ISSUED", issueDate: "2030-01-01", closingDate: "2030-03-01" }).returning({ id: rfqs.id });
    const [{ id: s }] = await d.insert(suppliers).values({ name: "Supplier A" }).returning({ id: suppliers.id });
    await d.insert(rfqSuppliers).values({ rfqId, supplierId: s });
  }, 180_000);
  afterAll(async () => { await client?.close(); });

  it("numbers addenda and moves the closing date (and the matching project deadline) on an extension", async () => {
    const { addAddendumAction } = await import("../../app/procurement/rfqs/clarification-actions");
    const r1 = await addAddendumAction(null, form({ rfqId: String(rfqId), issuedOn: "2026-01-10", summary: "Item 2 wording" }));
    expect(r1?.errors).toBeUndefined();
    const r2 = await addAddendumAction(null, form({ rfqId: String(rfqId), issuedOn: "2026-01-12", summary: "More time", extendsDeadline: "on", newClosingDate: "2030-03-15" }));
    expect(r2?.message).toContain("Addendum 2 recorded");
    const [rfq] = await d.select().from(rfqs).where(eq(rfqs.id, rfqId));
    expect(rfq.closingDate).toBe("2030-03-15");
    const [p] = await d.select().from(projects).where(eq(projects.id, projectId));
    expect(p.submissionDeadline).toBe("2030-03-15");
    const ads = await d.select().from(tenderAddenda).where(eq(tenderAddenda.rfqId, rfqId));
    expect(ads.map((a) => a.number).sort()).toEqual([1, 2]);
    expect(ads.find((a) => a.number === 2)?.previousClosingDate).toBe("2030-03-01");
    expect(h.log.some((l) => l.startsWith("deadline_extended"))).toBe(true);
    const bad = await addAddendumAction(null, form({ rfqId: String(rfqId), issuedOn: "2026-01-13", summary: "Shorter", extendsDeadline: "on", newClosingDate: "2030-03-10" }));
    expect(bad?.errors?.[0]).toContain("after the current one");
  });

  it("saves the timetable but keeps the app's own actual dates", async () => {
    const { saveTimetableAction } = await import("../../app/procurement/timetable-actions");
    const r = await saveTimetableAction(null, form({
      projectId: String(projectId), planned_ANNOUNCEMENT: "2029-12-20", actual_ANNOUNCEMENT: "2025-12-31",
      planned_SUBMISSION: "2030-01-05", planned_CLARIFICATION_DEADLINE: "2020-01-01",
    }));
    expect(r?.message).toContain("to check");
    const rows = await d.select().from(tenderTimetableSteps).where(eq(tenderTimetableSteps.projectId, projectId));
    const ann = rows.find((x) => x.step === "ANNOUNCEMENT")!;
    expect(ann.plannedDate).toBe("2029-12-20");
    expect(ann.actualDate).toBeNull(); // the RFQ issue date is the actual
    const { loadTimetable, overdueTimetableAlerts } = await import("./timetable-server");
    const t = await loadTimetable({ id: projectId, procurementMethod: "PUBLIC_TENDER", twoEnvelope: false }, "2026-01-15");
    expect(t.rows.find((x) => x.step === "ANNOUNCEMENT")).toMatchObject({ actual: "2030-01-01", fromApp: true });
    expect(t.problems.some((p) => p.step === "SUBMISSION" && p.text.includes("minimum"))).toBe(true);
    const alerts = await overdueTimetableAlerts("2026-01-15");
    expect(alerts.map((a) => a.n.dedupeKey)).toEqual([`tender_step_overdue:${projectId}:CLARIFICATION_DEADLINE:2020-01-01`]);
  });

  it("refuses addenda after the technical opening", async () => {
    await d.update(projects).set({ technicalOpenedAt: new Date() }).where(eq(projects.id, projectId));
    const { addAddendumAction } = await import("../../app/procurement/rfqs/clarification-actions");
    const r = await addAddendumAction(null, form({ rfqId: String(rfqId), issuedOn: "2026-01-14", summary: "Late change" }));
    expect(r?.errors?.[0]).toContain("art. 19");
  });
});
