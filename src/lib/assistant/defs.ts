/**
 * The in-app assistant's tools (wave 13): read-only look-ups over PAMS data. Each needs a permission; a role sees only
 * the tools it may use, and the server checks again and limits results to the user's hospitals. Pure (no database).
 */
import { can, type Permission, type Role } from "../auth/permissions";

export type ToolDef = { name: string; description: string; need: Permission; input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] } };

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });

export const TOOLS: ToolDef[] = [
  { name: "list_facilities", need: "assets.view", description: "The hospitals this user can see, with id, code, name, city and beds.", input_schema: { type: "object", properties: {} } },
  { name: "search_assets", need: "assets.view", description: "Find devices by words in the tag, type, maker, model or serial number; optionally in one hospital or with one status. Returns up to 50.",
    input_schema: { type: "object", properties: { query: str("Words to look for; leave empty for all"), facility_id: int("Hospital id"), status: { type: "string", enum: ["IN_STOCK", "INSTALLED", "IN_SERVICE", "UNDER_MAINTENANCE", "OUT_OF_SERVICE", "DISPOSED"] } } } },
  { name: "get_asset", need: "assets.view", description: "One device by its asset tag: details, location, warranty and its last 10 work orders.", input_schema: { type: "object", properties: { tag: str("Asset tag") }, required: ["tag"] } },
  { name: "open_work_orders", need: "assets.view", description: "Work orders not yet completed, most urgent first; optionally for one hospital.", input_schema: { type: "object", properties: { facility_id: int("Hospital id") } } },
  { name: "search_device_types", need: "assets.view", description: "Device catalogue: types matching the words, with risk class, life, PPM interval, price range and the parameters a specification should cover.",
    input_schema: { type: "object", properties: { query: str("Words in the name or code") }, required: ["query"] } },
  { name: "list_projects", need: "procurement.view", description: "Procurement projects and tenders, optionally matching words or with one status.",
    input_schema: { type: "object", properties: { query: str("Words in the code or title"), status: { type: "string", enum: ["PLANNING", "SPECIFICATION", "RFQ", "EVALUATION", "AWARDED", "DELIVERY", "CLOSED", "CANCELLED"] } } } },
  { name: "get_project", need: "procurement.view", description: "One project by code: status, budget, deadline, number of offers, and its purchase orders. Offer prices are not shown.", input_schema: { type: "object", properties: { code: str("Project code") }, required: ["code"] } },
  { name: "search_suppliers", need: "procurement.view", description: "Suppliers matching words in the name or brands, with country, type, brands and contact.", input_schema: { type: "object", properties: { query: str("Words to look for") } } },
  { name: "purchase_orders", need: "procurement.view", description: "Purchase orders, newest first, optionally with one status or for one supplier name.",
    input_schema: { type: "object", properties: { status: str("PO status, e.g. ISSUED"), supplier: str("Words in the supplier name") } } },
  { name: "budget_status", need: "procurement.view", description: "Budget lines for a year with amount, committed, spent and remaining.", input_schema: { type: "object", properties: { year: int("Year; defaults to this year"), facility_id: int("Hospital id") } } },
];

export const toolsFor = (role: Role | string) => TOOLS.filter((t) => can(role, t.need));

/** Keep a tool result small enough for the model: long arrays are cut, then the text. */
export function clip(value: unknown, max = 12_000): string {
  let s = JSON.stringify(value);
  if (s.length <= max) return s;
  if (Array.isArray(value)) {
    let n = value.length;
    while (n > 1 && s.length > max) { n = Math.floor(n * 0.7); s = JSON.stringify({ shown: n, of: value.length, items: value.slice(0, n) }); }
  }
  return s.length > max ? `${s.slice(0, max)}… (cut)` : s;
}

export type ChatTurn = { role: "user" | "assistant"; text: string };
/** The conversation sent to the model: the last 20 turns, starting with the user, each at most 8,000 characters. */
export function trimHistory(h: ChatTurn[]): ChatTurn[] {
  const out = h.filter((t) => t.text.trim()).slice(-20).map((t) => ({ ...t, text: t.text.slice(0, 8000) }));
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}
