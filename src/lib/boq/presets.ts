/** Quick scope presets for /boq/new. Pure data — beds and rooms are typical planning figures the user then edits. */
export interface PresetRow { departmentTypeCode: string; label: string; beds: number; rooms: number; instances: number }
export interface Preset { key: string; name: string; description: string; totalBeds: number; rows: PresetRow[] }

const r = (departmentTypeCode: string, label: string, beds = 0, rooms = 0, instances = 1): PresetRow =>
  ({ departmentTypeCode, label, beds, rooms, instances });

export const PRESETS: Preset[] = [
  {
    key: "gh100", name: "100-bed general hospital", totalBeds: 100,
    description: "ER, 10-bed ICU, 4 theatres, medical, surgical, paediatric and obstetric wards, radiology, lab, CSSD.",
    rows: [
      r("ER", "Emergency", 10, 4), r("ICU", "Adult ICU", 10), r("CCU", "Coronary care", 4),
      r("OR", "Operating theatres", 0, 4), r("PACU", "Recovery", 6),
      r("WARD-MED", "Medical ward", 26, 7), r("WARD-SURG", "Surgical ward", 26, 7), r("WARD-PED", "Paediatric ward", 12, 3),
      r("WARD-OBS", "Obstetrics & gynaecology ward", 12, 3), r("LDR", "Labour & delivery", 0, 2),
      r("RAD", "Radiology", 0, 5), r("LAB", "Clinical laboratory", 0, 3), r("ENDO", "Endoscopy", 0, 1),
      r("OPD", "Outpatient clinics", 0, 10), r("CSSD", "Central sterile services"), r("PHARM", "Pharmacy"),
    ],
  },
  {
    key: "gh200", name: "200-bed general hospital", totalBeds: 200,
    description: "Larger ER, 20-bed ICU, NICU, 6 theatres, two medical wards, dialysis, radiology with CT and MRI.",
    rows: [
      r("ER", "Emergency", 20, 8), r("ICU", "Adult ICU", 20), r("CCU", "Coronary care", 8), r("NICU", "Neonatal ICU", 10),
      r("OR", "Operating theatres", 0, 6), r("PACU", "Recovery", 10),
      r("WARD-MED", "Medical ward", 30, 8, 2), r("WARD-SURG", "Surgical ward", 30, 8), r("WARD-PED", "Paediatric ward", 20, 5),
      r("WARD-OBS", "Obstetrics & gynaecology ward", 20, 5), r("LDR", "Labour & delivery", 0, 4),
      r("RAD", "Radiology", 0, 8), r("LAB", "Clinical laboratory", 0, 4), r("ENDO", "Endoscopy", 0, 2), r("DIAL", "Haemodialysis", 12),
      r("OPD", "Outpatient clinics", 0, 20), r("CSSD", "Central sterile services"), r("PHARM", "Pharmacy"), r("BIOMED", "Biomedical engineering"),
    ],
  },
  {
    key: "radcentre", name: "Radiology centre", totalBeds: 0,
    description: "Stand-alone diagnostic imaging centre: imaging rooms, a small lab and a recovery/observation area.",
    rows: [r("RAD", "Imaging department", 0, 6), r("LAB", "Sample lab", 0, 1), r("OPD", "Consultation rooms", 0, 2)],
  },
];
