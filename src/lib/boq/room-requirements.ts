/**
 * Room requirements (pure): what a big device needs from its room, checked against the real rooms of the linked
 * department (areas from the CAD outlines). DRAFT planning figures — confirm with the vendor's site planning guide.
 */

export type RoomNeed = {
  prefix: string; label: string;
  /** Minimum clear floor area of the room the device stands in, m². */
  minArea: number;
  shielding?: string; power?: string; hvac?: string; floorLoad?: string;
};

export const ROOM_NEEDS: RoomNeed[] = [
  { prefix: "IMG-MRI", label: "MRI scanner", minArea: 40, shielding: "RF cage (Faraday) and magnetic shielding; 5-gauss line inside the controlled area", power: "≈ 100 kVA", hvac: "Chilled water for the cold head; quench pipe to outside", floorLoad: "≈ 6–8 t over the magnet footprint" },
  { prefix: "IMG-CT", label: "CT scanner", minArea: 30, shielding: "Lead lining (≈ 2 mm Pb equivalent, per the physicist's survey)", power: "≈ 80–150 kVA", hvac: "Equipment heat load ≈ 10 kW", floorLoad: "≈ 2–3 t on the gantry footprint" },
  { prefix: "IMG-ANG", label: "Angiography / cath lab", minArea: 45, shielding: "Lead lining (≈ 2 mm Pb)", power: "≈ 100 kVA", hvac: "Theatre-grade ventilation" },
  { prefix: "IMG-XR-DR", label: "Fixed X-ray room", minArea: 25, shielding: "Lead lining (≈ 2 mm Pb)", power: "≈ 60–80 kVA" },
  { prefix: "IMG-MAM", label: "Mammography", minArea: 12, shielding: "Lead lining (≈ 1 mm Pb)" },
  { prefix: "IMG-NM", label: "Gamma camera", minArea: 30, shielding: "Lead lining; hot lab nearby" },
  { prefix: "SUR-OR-TABLE", label: "Operating theatre", minArea: 36, power: "Isolated power (IT) supply", hvac: "Laminar or turbulent theatre ventilation, ≥ 20 air changes an hour" },
  { prefix: "THR-RT-LIN", label: "Linear accelerator", minArea: 50, shielding: "Concrete bunker designed by a physicist", power: "≈ 100 kVA", floorLoad: "≈ 8–10 t" },
];

export const needFor = (code: string) => ROOM_NEEDS.filter((n) => code.startsWith(n.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0] ?? null;

export type ReqLine = { boqDepartmentId: number | null; department: string; linked: boolean; deviceCode: string; deviceName: string; quantity: number };
export type ReqRoom = { id: number; departmentBoqId: number; name: string; code: string; area: number };
export type ReqResult = {
  department: string; device: string; need: RoomNeed; quantity: number;
  /** Rooms of the department big enough, biggest first (the device needs `quantity` of them). */
  fitting: ReqRoom[]; largest: ReqRoom | null;
  status: "ok" | "short" | "no-rooms" | "not-linked";
};

/** One device needs one room. Rooms are matched biggest first and are not shared between device types. */
export function checkRooms(lines: ReqLine[], rooms: ReqRoom[]): ReqResult[] {
  const out: ReqResult[] = [];
  const used = new Set<number>();
  const items = lines.filter((l) => l.quantity > 0).flatMap((l) => { const need = needFor(l.deviceCode); return need ? [{ l, need }] : []; })
    .sort((a, b) => b.need.minArea - a.need.minArea); // the most demanding devices pick rooms first
  for (const { l, need } of items) {
    if (!l.linked || l.boqDepartmentId == null) { out.push({ department: l.department, device: l.deviceName, need, quantity: l.quantity, fitting: [], largest: null, status: "not-linked" }); continue; }
    const mine = rooms.filter((r) => r.departmentBoqId === l.boqDepartmentId).sort((a, b) => b.area - a.area);
    if (!mine.length) { out.push({ department: l.department, device: l.deviceName, need, quantity: l.quantity, fitting: [], largest: null, status: "no-rooms" }); continue; }
    const free = mine.filter((r) => !used.has(r.id));
    const fitting = free.filter((r) => r.area >= need.minArea).slice(0, l.quantity);
    for (const r of fitting) used.add(r.id);
    out.push({ department: l.department, device: l.deviceName, need, quantity: l.quantity, fitting, largest: free[0] ?? mine[0], status: fitting.length >= l.quantity ? "ok" : "short" });
  }
  return out;
}
