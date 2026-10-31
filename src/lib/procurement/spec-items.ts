/** Spec item building and editing rules. Pure — safe on server and client. */
import { GENERAL_SPEC_ITEMS } from "./labels";
import { SPEC_LIBRARY } from "./spec-library";

export type EditableSpecItem = {
  id?: number;
  section: string;
  parameter: string;
  requirement: string;
  unit: string;
  mandatory: boolean;
  weight: number;
};

export type TemplateEntry = { name: string; unit?: string; hint?: string };

/**
 * First draft of a specification: the device type's own template (taxonomy specTemplate) when it has one,
 * otherwise the built-in starter library, followed by the general commercial / regulatory conditions.
 */
export function initialSpecItems(code: string, template: TemplateEntry[] | null | undefined, includeGeneral = true): {
  items: EditableSpecItem[]; source: "template" | "library" | "general";
} {
  let items: EditableSpecItem[] = [];
  let source: "template" | "library" | "general" = "general";
  if (template && template.length) {
    source = "template";
    // Templates name the parameters; when the starter library has a concrete requirement for the same parameter, use it.
    const lib = SPEC_LIBRARY[code] ?? [];
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    items = template.map((t) => {
      const match = lib.find((l) => norm(l.parameter) === norm(t.name));
      return {
        section: match?.section ?? "Technical", parameter: t.name,
        requirement: match?.requirement ?? (t.hint ? `${t.hint.charAt(0).toUpperCase()}${t.hint.slice(1)}` : "To be specified"),
        unit: t.unit && t.unit !== "text" ? t.unit : "", mandatory: match?.mandatory ?? true, weight: match?.weight ?? 1,
      };
    });
  } else if (SPEC_LIBRARY[code]) {
    source = "library";
    items = SPEC_LIBRARY[code].map((i) => ({ ...i, unit: i.unit ?? "" }));
  }
  if (includeGeneral) {
    items.push(...GENERAL_SPEC_ITEMS.map((g) => ({ section: "General conditions", ...g, unit: g.unit ?? "" })));
  }
  return { items, source };
}

export type SpecItemPlan = {
  insert: (EditableSpecItem & { sortOrder: number })[];
  update: (EditableSpecItem & { id: number; sortOrder: number })[];
  remove: number[];
  errors: string[];
};

/** Normalise and validate edited rows, then diff against existing ids (keeps compliance answers on unchanged items). */
export function planSpecItems(existingIds: number[], rows: unknown): SpecItemPlan {
  const plan: SpecItemPlan = { insert: [], update: [], remove: [], errors: [] };
  if (!Array.isArray(rows)) { plan.errors.push("The specification rows could not be read. Reload the page and try again."); return plan; }
  const keep = new Set<number>();
  let order = 0;
  rows.forEach((raw, idx) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const s = (k: string, max: number) => (typeof r[k] === "string" ? (r[k] as string).trim().slice(0, max) : "");
    const parameter = s("parameter", 300);
    const requirement = s("requirement", 1000);
    const section = s("section", 120);
    const unit = s("unit", 32);
    if (!parameter && !requirement) return; // blank row: ignore
    if (!parameter) { plan.errors.push(`Row ${idx + 1}: enter the parameter name.`); return; }
    if (!requirement) { plan.errors.push(`Row ${idx + 1} (${parameter}): enter the requirement.`); return; }
    const w = Number(r.weight);
    if (!Number.isFinite(w) || w < 0 || w > 100) { plan.errors.push(`Row ${idx + 1} (${parameter}): weight must be between 0 and 100.`); return; }
    const item = { section, parameter, requirement, unit, mandatory: Boolean(r.mandatory), weight: w, sortOrder: (order += 10) };
    const id = typeof r.id === "number" && existingIds.includes(r.id) && !keep.has(r.id) ? r.id : undefined;
    if (id) { keep.add(id); plan.update.push({ ...item, id }); } else plan.insert.push(item);
  });
  plan.remove = existingIds.filter((id) => !keep.has(id));
  if (!plan.errors.length && plan.insert.length + plan.update.length === 0) plan.errors.push("A specification needs at least one parameter.");
  return plan;
}
