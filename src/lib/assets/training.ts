/**
 * User training records (wave 27). Pure.
 *
 * A session trains people on one device type. A person counts as trained on a type from their latest session on it;
 * when that is older than the set period (Administration › Settings, default 2 years) their training is due again.
 * People are matched by account when they have one, else by name (case and spaces ignored).
 */
import { addMonths } from "./dates";

export const TRAINING_KINDS = ["INITIAL", "REFRESHER", "SUPPLIER"] as const;
export type TrainingKind = (typeof TRAINING_KINDS)[number];
export const TRAINING_KIND_LABELS: Record<TrainingKind, string> = { INITIAL: "Initial", REFRESHER: "Refresher", SUPPLIER: "By the supplier" };
export const DEFAULT_TRAINING_VALID_MONTHS = 24;

export type TypedAttendee = { name: string; departmentText: string | null };

/** "Name, Department" per line (department optional); blank lines and repeats dropped. At most 200. */
export function parseAttendees(text: string | null | undefined): TypedAttendee[] {
  const out: TypedAttendee[] = [];
  const seen = new Set<string>();
  for (const line of (text ?? "").split(/\r?\n/)) {
    const [rawName, ...rest] = line.split(/[,;\t]/);
    const name = rawName.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const key = personKey(null, name);
    if (seen.has(key)) continue;
    seen.add(key);
    const dept = rest.join(",").replace(/\s+/g, " ").trim();
    out.push({ name: name.slice(0, 120), departmentText: dept ? dept.slice(0, 120) : null });
    if (out.length >= 200) break;
  }
  return out;
}

/** Ticked account ids from a form: positive whole numbers, no repeats, at most 400. */
export function parseUserIds(values: unknown[]): number[] {
  const out = new Set<number>();
  for (const v of values) {
    const n = Number(typeof v === "string" ? v.trim() : v);
    if (Number.isInteger(n) && n > 0) out.add(n);
    if (out.size >= 400) break;
  }
  return [...out];
}

export function personKey(userId: number | null | undefined, name: string): string {
  return userId ? `u:${userId}` : `n:${name.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

export type Attendance = { deviceTypeId: number; userId: number | null; name: string; heldOn: string; kind: TrainingKind };
export type TrainedPerson = { key: string; name: string; userId: number | null; lastOn: string; kind: TrainingKind; dueOn: string; state: "current" | "due" };
export type TypeTraining = { deviceTypeId: number; people: TrainedPerson[]; current: number; due: number };

/** When training taken on `on` should be refreshed. */
export function refreshDue(on: string, validMonths: number): string {
  return addMonths(on, validMonths > 0 ? validMonths : DEFAULT_TRAINING_VALID_MONTHS);
}

/** Who is trained on each device type, latest session per person, and whose training is older than the period. */
export function trainingByType(typeIds: number[], rows: Attendance[], validMonths: number, today: string): TypeTraining[] {
  return typeIds.map((t) => {
    const latest = new Map<string, Attendance>();
    for (const r of rows) {
      if (r.deviceTypeId !== t) continue;
      const k = personKey(r.userId, r.name);
      const had = latest.get(k);
      if (!had || r.heldOn > had.heldOn) latest.set(k, r);
    }
    const people = [...latest.entries()].map(([key, r]): TrainedPerson => {
      const dueOn = refreshDue(r.heldOn, validMonths);
      return { key, name: r.name, userId: r.userId, lastOn: r.heldOn, kind: r.kind, dueOn, state: dueOn < today ? "due" : "current" };
    }).sort((a, b) => (a.state === b.state ? a.name.localeCompare(b.name) : a.state === "due" ? -1 : 1));
    return { deviceTypeId: t, people, current: people.filter((p) => p.state === "current").length, due: people.filter((p) => p.state === "due").length };
  });
}

/** Match a typed department name to one of the hospital's departments (case and spaces ignored), or null. */
export function matchDepartment(text: string | null, departments: { id: number; name: string; code?: string | null }[]): number | null {
  if (!text) return null;
  const k = text.toLowerCase().replace(/\s+/g, " ").trim();
  return departments.find((d) => d.name.toLowerCase().replace(/\s+/g, " ").trim() === k || (d.code ?? "").toLowerCase() === k)?.id ?? null;
}
