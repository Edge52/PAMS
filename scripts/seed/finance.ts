/**
 * Demo data for the money side (wave 27). Idempotent:
 * - a residual value of 10 % on imaging device types, once (only while no type has a residual value yet);
 * - licences, registrations and certificates with expiry dates for six suppliers: some valid, some expiring within
 *   30 and 60 days, one expired, so the supplier pages, the expiring list and the PO/award warning have something to
 *   show. Skipped when demo documents are already there. The files are short text placeholders.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, isNotNull, like, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import { deviceTypes, documents, suppliers } from "../../src/db/schema";

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/** supplier name → [type, file name, days from today until expiry (null = none)] */
const DOCS: Record<string, [string, string, number | null][]> = {
  "Nile Medical Systems": [["eda_registration", "EDA registration", 45], ["iso_13485", "ISO 13485 certificate", 400], ["agency_letter", "Mindray agency letter", 220]],
  "Delta Biomedical Trading": [["eda_registration", "EDA registration", 300], ["iso_13485", "ISO 13485 certificate", 520], ["commercial_register", "Commercial register", null]],
  "Pyramids Healthcare Solutions": [["agency_letter", "GE HealthCare authorisation", 25], ["eda_registration", "EDA registration", 610]],
  "Cairo MedTech Engineering": [["iso_13485", "ISO 13485 certificate", 12], ["eda_registration", "EDA registration", 180], ["tax_card", "Tax card", null]],
  "Alex Critical Care Supplies": [["licence", "Medical device trading licence", 75], ["iso_13485", "ISO 13485 certificate", 260]],
  "Sinai Imaging & Diagnostics": [["eda_registration", "EDA registration", -20], ["agency_letter", "Canon Medical agency letter", 140]],
};

export default async function seed(db: DB) {
  const [{ n: withResidual }] = await db.select({ n: sql<number>`count(*)::int` }).from(deviceTypes).where(isNotNull(deviceTypes.residualPct));
  if (withResidual === 0) {
    const r = await db.update(deviceTypes).set({ residualPct: 10 }).where(and(like(deviceTypes.code, "IMG-%"), eq(deviceTypes.level, 3))).returning({ id: deviceTypes.id });
    console.log(`  finance: residual value 10 % on ${r.length} imaging types`);
  }

  const [{ n: have }] = await db.select({ n: sql<number>`count(*)::int` }).from(documents)
    .where(and(eq(documents.entityType, "supplier"), like(documents.fileName, "Demo %")));
  if (have > 0) { console.log("  finance: supplier documents already there"); return; }
  const list = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.id));
  const root = path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), "storage", "uploads"));
  let made = 0;
  for (const s of list) {
    const docs = DOCS[s.name];
    if (!docs) continue;
    const dir = path.join(root, "supplier", String(s.id));
    await mkdir(dir, { recursive: true });
    for (const [kind, title, days] of docs) {
      const fileName = `Demo ${title} - ${s.name}.txt`;
      const stored = `${Date.now()}-${fileName.replace(/[^\w.\- ]+/g, "_")}`;
      await writeFile(path.join(dir, stored), `Demo placeholder: ${title} for ${s.name}.${days != null ? ` Valid until ${iso(days)}.` : ""}\n`);
      await db.insert(documents).values({
        entityType: "supplier", entityId: s.id, kind, fileName, url: `/files/supplier/${s.id}/${encodeURIComponent(stored)}`,
        sizeBytes: 80, expiresOn: days == null ? null : iso(days),
      });
      made++;
    }
  }
  console.log(`  finance: ${made} supplier documents`);
}
