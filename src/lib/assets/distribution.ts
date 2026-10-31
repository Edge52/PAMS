/**
 * Bulk placement: spread N new assets over a department's rooms.
 * "12 monitors, one in each ICU bed" → mode PER_BED, quantity 12.
 * Pure — used by the bulk form preview (client) and re-run by the server action before creating anything.
 */

export type DistRoom = { id: number; code: string; name: string; beds: number; type?: string | null };
export type DistMode = "PER_ROOM" | "PER_BED" | "ONE_ROOM" | "MANUAL";
export const DIST_MODES: { value: DistMode; label: string; hint: string }[] = [
  { value: "PER_BED", label: "One per bed", hint: "Fills every bed in room order — the usual choice for monitors, pumps and beds." },
  { value: "PER_ROOM", label: "One per room", hint: "One in each room (corridors excluded), in room order." },
  { value: "ONE_ROOM", label: "All in one room", hint: "Everything goes into a single room, e.g. a store or nurse station." },
  { value: "MANUAL", label: "Manual counts", hint: "Type how many go into each room." },
];

export type Allocation = { roomId: number; count: number };
export type DistResult = { allocations: Allocation[]; total: number; warnings: string[] };

export function eligibleRooms(rooms: DistRoom[]): DistRoom[] {
  return rooms.filter((r) => r.type !== "CORRIDOR");
}

function finish(counts: Map<number, number>, rooms: DistRoom[], warnings: string[]): DistResult {
  const allocations = rooms.map((r) => ({ roomId: r.id, count: counts.get(r.id) ?? 0 })).filter((a) => a.count > 0);
  return { allocations, total: allocations.reduce((s, a) => s + a.count, 0), warnings };
}

export function distribute(input: {
  mode: DistMode;
  rooms: DistRoom[];
  quantity: number;
  targetRoomId?: number | null;
  manual?: Record<number, number>;
}): DistResult {
  const quantity = Math.max(0, Math.floor(input.quantity || 0));
  const rooms = eligibleRooms(input.rooms);
  const counts = new Map<number, number>();
  const warnings: string[] = [];

  if (input.mode === "MANUAL") {
    for (const r of rooms) {
      const n = Math.max(0, Math.floor(input.manual?.[r.id] ?? 0));
      if (n) counts.set(r.id, n);
    }
    const res = finish(counts, rooms, warnings);
    if (res.total !== quantity) warnings.push(`Room counts add up to ${res.total}, not the quantity of ${quantity}.`);
    return res;
  }

  if (input.mode === "ONE_ROOM") {
    const target = rooms.find((r) => r.id === input.targetRoomId);
    if (!target) return { allocations: [], total: 0, warnings: ["Choose the room that receives all units."] };
    if (quantity) counts.set(target.id, quantity);
    return finish(counts, rooms, warnings);
  }

  // Slots: one per room, or one per bed (rooms repeated by bed count).
  const slots: number[] = [];
  if (input.mode === "PER_BED") {
    for (const r of rooms) for (let b = 0; b < r.beds; b++) slots.push(r.id);
    if (!slots.length) return { allocations: [], total: 0, warnings: ["This department has no rooms with beds. Use one per room or manual counts."] };
  } else {
    for (const r of rooms) slots.push(r.id);
    if (!slots.length) return { allocations: [], total: 0, warnings: ["This department has no rooms yet. Add rooms on the facility page first."] };
  }
  for (let i = 0; i < quantity; i++) {
    const id = slots[i % slots.length];
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const unit = input.mode === "PER_BED" ? "bed" : "room";
  if (quantity > slots.length) {
    warnings.push(`${quantity - slots.length} more than there are ${unit}s (${slots.length}) — some ${unit}s get two.`);
  } else if (quantity < slots.length) {
    const left = slots.length - quantity;
    warnings.push(`${left} ${unit}${left === 1 ? "" : "s"} will get none.`);
  }
  return finish(counts, rooms, warnings);
}

/** Expand allocations to one room id per unit, in allocation order. */
export function expandAllocations(allocs: Allocation[]): number[] {
  return allocs.flatMap((a) => Array.from({ length: a.count }, () => a.roomId));
}

/** One serial per line; blank lines dropped; trimmed. */
export function parseSerials(text: string | null | undefined): string[] {
  return (text ?? "").split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
}
