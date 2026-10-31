/**
 * Demo hospital: one facility, one main building, six floors, departments and rooms laid out on a
 * 1000 × 600 plan grid. OWNED BY THE LEAD (assets agent may extend room geometry, but keep codes stable).
 */
import { eq } from "drizzle-orm";
import type { DB } from "../../src/db";
import { buildings, departments, facilities, floors, rooms } from "../../src/db/schema";

type RoomType = typeof rooms.$inferInsert["type"];
type DeptSpec = { type: string | null; code: string; name: string; nameAr: string; beds?: number;
  rooms: { prefix: string; name: string; type: RoomType; count: number; beds?: number; w?: number; h?: number }[] };

/** floor level → departments placed left to right, top row then bottom row. */
const layout: Record<number, { name: string; depts: DeptSpec[] }> = {
  [-1]: { name: "Basement", depts: [
    { type: "CSSD", code: "CSSD", name: "Central sterile services", nameAr: "التعقيم المركزي", rooms: [
      { prefix: "DEC", name: "Decontamination", type: "TECHNICAL", count: 1, w: 180 },
      { prefix: "PAK", name: "Packing & sterilization", type: "TECHNICAL", count: 1, w: 200 },
      { prefix: "STR", name: "Sterile store", type: "STORE", count: 1 } ] },
    { type: "BIOMED", code: "BME", name: "Biomedical engineering", nameAr: "الهندسة الطبية", rooms: [
      { prefix: "WS", name: "Workshop", type: "TECHNICAL", count: 1, w: 160 }, { prefix: "ST", name: "Spare parts store", type: "STORE", count: 1 } ] },
    { type: "MORT", code: "MORT", name: "Mortuary", nameAr: "ثلاجة الموتى", rooms: [{ prefix: "CR", name: "Cold room", type: "OTHER", count: 1 }] },
  ] },
  0: { name: "Ground floor", depts: [
    { type: "ER", code: "ER", name: "Emergency", nameAr: "الطوارئ", beds: 12, rooms: [
      { prefix: "TRI", name: "Triage", type: "CONSULTATION", count: 1 },
      { prefix: "RES", name: "Resuscitation bay", type: "PROCEDURE_ROOM", count: 2, beds: 1 },
      { prefix: "OBS", name: "Observation bay", type: "WARD", count: 2, beds: 5, w: 130 },
      { prefix: "NS", name: "Nurse station", type: "NURSE_STATION", count: 1, w: 70 } ] },
    { type: "RAD", code: "RAD", name: "Radiology", nameAr: "الأشعة", rooms: [
      { prefix: "CT", name: "CT room", type: "IMAGING_ROOM", count: 1, w: 120 }, { prefix: "MRI", name: "MRI suite", type: "IMAGING_ROOM", count: 1, w: 140 },
      { prefix: "XR", name: "X-ray room", type: "IMAGING_ROOM", count: 2 }, { prefix: "US", name: "Ultrasound room", type: "IMAGING_ROOM", count: 2, w: 80 },
      { prefix: "MAM", name: "Mammography room", type: "IMAGING_ROOM", count: 1, w: 80 } ] },
    { type: "PHARM", code: "PHARM", name: "Pharmacy", nameAr: "الصيدلية", rooms: [{ prefix: "DSP", name: "Dispensary", type: "PHARMACY", count: 1 }] },
  ] },
  1: { name: "First floor", depts: [
    { type: "OPD", code: "OPD", name: "Outpatient clinics", nameAr: "العيادات الخارجية", rooms: [
      { prefix: "CLN", name: "Clinic", type: "CONSULTATION", count: 8, w: 85 }, { prefix: "WAIT", name: "Waiting area", type: "WAITING", count: 1, w: 160 } ] },
    { type: "LAB", code: "LAB", name: "Clinical laboratory", nameAr: "المعمل", rooms: [
      { prefix: "HEM", name: "Haematology lab", type: "LAB", count: 1, w: 120 }, { prefix: "CHE", name: "Chemistry lab", type: "LAB", count: 1, w: 120 },
      { prefix: "SMP", name: "Sample collection", type: "PROCEDURE_ROOM", count: 1 } ] },
    { type: "ENDO", code: "ENDO", name: "Endoscopy", nameAr: "المناظير", rooms: [{ prefix: "END", name: "Endoscopy room", type: "PROCEDURE_ROOM", count: 2 }] },
  ] },
  2: { name: "Second floor", depts: [
    { type: "OR", code: "OR", name: "Operating theatres", nameAr: "غرف العمليات", rooms: [
      { prefix: "OR", name: "Operating room", type: "OPERATING_ROOM", count: 4, w: 130 } ] },
    { type: "PACU", code: "PACU", name: "Recovery", nameAr: "الإفاقة", beds: 6, rooms: [{ prefix: "REC", name: "Recovery bay", type: "WARD", count: 1, beds: 6, w: 180 }] },
    // A store inside the theatre suite, not a second sterile-services department: untyped, so no BOQ rules apply.
    { type: null, code: "SSU", name: "Theatre sterile supply", nameAr: "تعقيم العمليات", rooms: [{ prefix: "SSU", name: "Sterile supply", type: "STORE", count: 1 }] },
  ] },
  3: { name: "Third floor", depts: [
    { type: "ICU", code: "ICU", name: "Adult ICU", nameAr: "العناية المركزة للبالغين", beds: 12, rooms: [
      { prefix: "BED", name: "ICU bed", type: "ICU_BAY", count: 12, beds: 1, w: 70 }, { prefix: "NS", name: "Nurse station", type: "NURSE_STATION", count: 1, w: 110 } ] },
    { type: "CCU", code: "CCU", name: "Coronary care", nameAr: "العناية المركزة للقلب", beds: 6, rooms: [
      { prefix: "BED", name: "CCU bed", type: "ICU_BAY", count: 6, beds: 1, w: 70 } ] },
  ] },
  4: { name: "Fourth floor", depts: [
    { type: "WARD-MED", code: "MED", name: "Medical ward", nameAr: "باطنة", beds: 24, rooms: [
      { prefix: "PR", name: "Patient room", type: "PATIENT_ROOM", count: 6, beds: 4, w: 90 }, { prefix: "NS", name: "Nurse station", type: "NURSE_STATION", count: 1, w: 70 } ] },
    { type: "WARD-SURG", code: "SURG", name: "Surgical ward", nameAr: "جراحة", beds: 24, rooms: [
      { prefix: "PR", name: "Patient room", type: "PATIENT_ROOM", count: 6, beds: 4, w: 90 }, { prefix: "NS", name: "Nurse station", type: "NURSE_STATION", count: 1, w: 70 } ] },
  ] },
};

export default async function seed(db: DB) {
  const existing = await db.select().from(facilities).where(eq(facilities.code, "DGH"));
  if (existing.length) { console.log("  facility DGH exists, skipped"); return; }

  const totalBeds = Object.values(layout).flatMap((f) => f.depts).reduce((s, d) => s + (d.beds ?? 0), 0);
  const [fac] = await db.insert(facilities).values({
    code: "DGH", name: "Demo General Hospital", nameAr: "المستشفى العام التجريبي", type: "GENERAL_HOSPITAL",
    governorate: "Cairo", city: "New Cairo", totalBeds,
  }).returning();
  const [bld] = await db.insert(buildings).values({ facilityId: fac.id, code: "B1", name: "Main building" }).returning();

  for (const [lvlStr, fl] of Object.entries(layout)) {
    const level = Number(lvlStr);
    const [floor] = await db.insert(floors).values({ buildingId: bld.id, level, name: fl.name, planWidth: 1000, planHeight: 600 }).returning();
    // Simple packing: rooms flow left→right in two bands (y=40 and y=340) with a corridor between.
    let x = 20, y = 40, rowH = 0;
    const gap = 10;
    for (const ds of fl.depts) {
      const [dept] = await db.insert(departments).values({
        facilityId: fac.id, departmentTypeCode: ds.type, code: ds.code, name: ds.name, nameAr: ds.nameAr, beds: ds.beds ?? 0,
      }).returning();
      for (const rs of ds.rooms) {
        for (let i = 1; i <= rs.count; i++) {
          const w = rs.w ?? 100, h = Math.max(rs.h ?? 200, 200);
          if (x + w > 980) {
            if (y !== 40) throw new Error(`Floor ${level}: rooms don't fit in two bands; widen the plan or narrow the rooms`);
            x = 20; y = 340; rowH = 0;
          }
          const n = rs.count > 1 ? String(i).padStart(2, "0") : "";
          await db.insert(rooms).values({
            floorId: floor.id, departmentId: dept.id,
            code: `${level < 0 ? "B" : level}-${ds.code}-${rs.prefix}${n}`,
            name: rs.count > 1 ? `${rs.name} ${i}` : rs.name, type: rs.type, beds: rs.beds ?? 0, x, y, w, h,
          });
          x += w + gap; rowH = Math.max(rowH, h);
        }
      }
      x += 20; // breathing room between departments
    }
    // Corridor across the middle of each floor.
    await db.insert(rooms).values({ floorId: floor.id, code: `${level < 0 ? "B" : level}-COR`, name: "Main corridor", type: "CORRIDOR", x: 20, y: 270, w: 960, h: 50 });
  }
  console.log(`  facility DGH: ${Object.keys(layout).length} floors, ${totalBeds} beds`);
}
