/**
 * Arabic legal names (demo, wave 38): the demo suppliers' registered names and the demo committee members' names in
 * Arabic, for the letters and minutes. Only fills names that are missing, so it is safe to run again and never
 * overwrites a name typed by hand. Names are made up for the demo.
 */
import { inArray } from "drizzle-orm";
import type { DB } from "../../src/db";
import { committeeMemberLegalNames, committeeMembers, supplierLegalNames, suppliers } from "../../src/db/schema";

const SUPPLIERS: Record<string, string> = {
  "Nile Medical Systems": "شركة النيل للأنظمة الطبية (ش.م.م)",
  "Delta Biomedical Trading": "شركة الدلتا للتجارة في الأجهزة الطبية الحيوية",
  "Pyramids Healthcare Solutions": "شركة الأهرام لحلول الرعاية الصحية",
  "Cairo MedTech Engineering": "شركة القاهرة للهندسة والتكنولوجيا الطبية",
  "Alex Critical Care Supplies": "شركة الإسكندرية لمستلزمات الرعاية الحرجة",
  "Sinai Imaging & Diagnostics": "شركة سيناء للأشعة والتشخيص",
};

const MEMBERS: Record<string, string> = {
  "Omar Saeed": "عمر سعيد",
  "Eng. Sara Hamdy": "م. سارة حمدي",
  "Rania Lotfy": "رانيا لطفي",
  "Laila Hassan": "ليلى حسن",
  "Mr. Hesham Adel (Ministry of Finance)": "السيد/ هشام عادل (ممثل وزارة المالية)",
  "Counsellor Ahmed Ramzy (State Council, Fatwa Dept.)": "المستشار/ أحمد رمزي (مجلس الدولة - إدارة الفتوى)",
  "Mona Salah (procurement clerk)": "منى صلاح (أمين اللجنة)",
};

export default async function seed(db: DB) {
  const sup = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.name, Object.keys(SUPPLIERS)));
  let s = 0;
  for (const r of sup) {
    const done = await db.insert(supplierLegalNames).values({ supplierId: r.id, nameAr: SUPPLIERS[r.name] }).onConflictDoNothing().returning({ id: supplierLegalNames.supplierId });
    s += done.length;
  }
  const mem = await db.select({ id: committeeMembers.id, name: committeeMembers.name }).from(committeeMembers).where(inArray(committeeMembers.name, Object.keys(MEMBERS)));
  let m = 0;
  for (const r of mem) {
    const done = await db.insert(committeeMemberLegalNames).values({ memberId: r.id, nameAr: MEMBERS[r.name] }).onConflictDoNothing().returning({ id: committeeMemberLegalNames.memberId });
    m += done.length;
  }
  console.log(`  legal-names: ${s} supplier and ${m} committee member Arabic names added`);
}
