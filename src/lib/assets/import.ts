/**
 * Excel import of assets: template columns, header mapping, cell normalisation and row validation.
 * Pure — the server parses the workbook with exceljs, then hands plain cell values and lookups to these functions.
 */
import { ASSET_CONDITIONS, ASSET_STATUSES, type AssetCondition, type AssetStatus } from "./filters";
import { addMonths, isISODate, toISO } from "./dates";

export type ImportColumn = { key: ImportKey; header: string; required?: boolean; hint: string; example: string | number };
export type ImportKey =
  | "deviceTypeCode" | "roomCode" | "departmentCode" | "manufacturer" | "model" | "serialNumber" | "status" | "condition"
  | "purchaseDate" | "installDate" | "warrantyMonths" | "warrantyEnd" | "purchaseCost" | "currency" | "notes";

export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: "deviceTypeCode", header: "Device type code", required: true, hint: "Device type code from the catalogue (see the Device types sheet)", example: "MON-PAT-HIGH" },
  { key: "roomCode", header: "Room code", hint: "Room code (see the Rooms sheet). Sets the department too", example: "3-ICU-BED01" },
  { key: "departmentCode", header: "Department code", hint: "Only needed when there is no room yet", example: "ICU" },
  { key: "manufacturer", header: "Manufacturer", hint: "Manufacturer name", example: "Philips" },
  { key: "model", header: "Model", hint: "Model name", example: "IntelliVue MX750" },
  { key: "serialNumber", header: "Serial number", hint: "Must be unique in the register", example: "DE12345678" },
  { key: "status", header: "Status", hint: "In stock, Installed, In service, Under maintenance, Out of service. Blank: in service when a room is given, else in stock", example: "In service" },
  { key: "condition", header: "Condition", hint: "New, Good, Fair, Poor, Condemned. Blank: new", example: "New" },
  { key: "purchaseDate", header: "Purchase date", hint: "YYYY-MM-DD or an Excel date", example: "2026-03-15" },
  { key: "installDate", header: "Install date", hint: "YYYY-MM-DD or an Excel date", example: "2026-04-01" },
  { key: "warrantyMonths", header: "Warranty months", hint: "Counted from the install date (else the purchase date)", example: 24 },
  { key: "warrantyEnd", header: "Warranty end", hint: "Overrides warranty months", example: "" },
  { key: "purchaseCost", header: "Purchase cost", hint: "Number without currency symbol", example: 18500 },
  { key: "currency", header: "Currency", hint: "ISO code, e.g. USD, EUR, EGP", example: "USD" },
  { key: "notes", header: "Notes", hint: "Free text", example: "" },
];

export const MAX_IMPORT_ROWS = 2000;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Map a header row to column keys. Accepts the template headers or the camelCase keys, any case, with or without "*". */
export function mapHeaders(headers: unknown[]): { map: Map<number, ImportKey>; missing: string[]; unknown: string[] } {
  const lookup = new Map<string, ImportKey>();
  for (const c of IMPORT_COLUMNS) { lookup.set(squash(c.header), c.key); lookup.set(squash(c.key), c.key); }
  lookup.set("serial", "serialNumber"); lookup.set("type", "deviceTypeCode"); lookup.set("devicetype", "deviceTypeCode");
  lookup.set("room", "roomCode"); lookup.set("department", "departmentCode");
  const map = new Map<number, ImportKey>();
  const unknown: string[] = [];
  headers.forEach((h, i) => {
    const text = cellText(h);
    if (!text) return;
    const key = lookup.get(squash(text));
    if (key && ![...map.values()].includes(key)) map.set(i, key);
    else if (!key) unknown.push(text);
  });
  const have = new Set(map.values());
  const missing = IMPORT_COLUMNS.filter((c) => c.required && !have.has(c.key)).map((c) => c.header);
  return { map, missing, unknown };
}

/** Flatten an exceljs cell value (rich text, hyperlink, formula result, Date, number) into a primitive. */
export function normaliseCell(v: unknown): string | number | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number" || typeof v === "string") return typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return normaliseCell((o.richText as { text: string }[]).map((t) => t.text).join(""));
    if ("result" in o) return normaliseCell(o.result);
    if ("text" in o) return normaliseCell(o.text);
    if ("error" in o) return null;
  }
  return String(v);
}

export function cellText(v: unknown): string {
  const n = normaliseCell(v);
  if (n === null) return "";
  if (n instanceof Date) return toISO(n);
  return String(n).trim();
}

/** Excel serial day number → ISO date (1900 date system). */
export function excelSerialToISO(n: number): string {
  return toISO(new Date(Math.round((n - 25569) * 86_400_000)));
}

/** Accepts Date, Excel serial, YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY. Returns null for blank, "invalid" for bad input. */
export function parseDateCell(v: unknown): string | null | "invalid" {
  const n = normaliseCell(v);
  if (n === null) return null;
  if (n instanceof Date) return Number.isNaN(n.getTime()) ? "invalid" : toISO(n);
  if (typeof n === "number") return n > 20000 && n < 80000 ? excelSerialToISO(n) : "invalid";
  const s = n.trim();
  if (isISODate(s.slice(0, 10)) && (s.length === 10 || /^\d{4}-\d{2}-\d{2}T/.test(s))) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return isISODate(iso) ? iso : "invalid";
  }
  return "invalid";
}

function parseEnum<T extends string>(v: string, list: readonly T[]): T | null {
  const k = v.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (list as readonly string[]).includes(k) ? (k as T) : null;
}

export type Lookups = {
  deviceTypes: Map<string, { id: number; level: number; name: string }>;
  /** room code (upper case) → rooms with that code in the facility (normally one). */
  rooms: Map<string, { id: number; departmentId: number | null; name: string }[]>;
  departments: Map<string, { id: number; name: string }>;
  /** serial (upper case) → existing asset tag. */
  existingSerials: Map<string, string>;
};

export type ValidRow = {
  rowNumber: number;
  deviceTypeId: number;
  deviceTypeCode: string;
  roomId: number | null;
  departmentId: number | null;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  status: AssetStatus | null;
  condition: AssetCondition | null;
  purchaseDate: string | null;
  installDate: string | null;
  warrantyMonths: number | null;
  warrantyEnd: string | null;
  purchaseCost: number | null;
  currency: string | null;
  notes: string | null;
};

export type RowResult = {
  rowNumber: number;
  /** Display values (strings) keyed by column. */
  values: Partial<Record<ImportKey, string>>;
  errors: string[];
  valid: ValidRow | null;
};

export type RawRow = { rowNumber: number; cells: Partial<Record<ImportKey, unknown>> };

export function validateRows(raw: RawRow[], lk: Lookups): { rows: RowResult[]; valid: ValidRow[] } {
  const seenSerials = new Map<string, number>();
  const rows: RowResult[] = [];
  for (const r of raw) {
    const values: Partial<Record<ImportKey, string>> = {};
    for (const c of IMPORT_COLUMNS) {
      const t = cellText(r.cells[c.key]);
      if (t) values[c.key] = t;
    }
    if (Object.keys(values).length === 0) continue; // blank line
    const errors: string[] = [];
    const t = (k: ImportKey) => values[k] ?? null;

    const code = t("deviceTypeCode")?.toUpperCase() ?? null;
    const dt = code ? lk.deviceTypes.get(code) : undefined;
    if (!code) errors.push("Device type code is required.");
    else if (!dt) errors.push(`Device type ${code} is not in the catalogue.`);
    else if (dt.level !== 3) errors.push(`${code} is a category, not a device type — use a level-3 code.`);

    let roomId: number | null = null, departmentId: number | null = null;
    const roomCode = t("roomCode")?.toUpperCase() ?? null;
    if (roomCode) {
      const matches = lk.rooms.get(roomCode) ?? [];
      if (matches.length === 0) errors.push(`Room ${roomCode} does not exist in this facility.`);
      else if (matches.length > 1) errors.push(`Room code ${roomCode} is used on more than one floor — rename one of them.`);
      else { roomId = matches[0].id; departmentId = matches[0].departmentId; }
    }
    const deptCode = t("departmentCode")?.toUpperCase() ?? null;
    if (deptCode) {
      const d = lk.departments.get(deptCode);
      if (!d) errors.push(`Department ${deptCode} does not exist in this facility.`);
      else if (roomId && departmentId && departmentId !== d.id) errors.push(`Room ${roomCode} belongs to another department than ${deptCode}.`);
      else departmentId = d.id;
    }

    const serial = t("serialNumber");
    if (serial) {
      const key = serial.toUpperCase();
      if (serial.length > 128) errors.push("Serial number is longer than 128 characters.");
      const existing = lk.existingSerials.get(key);
      if (existing) errors.push(`Serial ${serial} is already registered as ${existing}.`);
      const prev = seenSerials.get(key);
      if (prev) errors.push(`Serial ${serial} also appears on row ${prev}.`);
      else seenSerials.set(key, r.rowNumber);
    }

    let status: AssetStatus | null = null;
    if (t("status")) {
      status = parseEnum(t("status") as string, ASSET_STATUSES);
      if (!status) errors.push(`Status "${t("status")}" is not one of: in stock, installed, in service, under maintenance, out of service, disposed.`);
    }
    let condition: AssetCondition | null = null;
    if (t("condition")) {
      condition = parseEnum(t("condition") as string, ASSET_CONDITIONS);
      if (!condition) errors.push(`Condition "${t("condition")}" is not one of: new, good, fair, poor, condemned.`);
    }

    const dates: Partial<Record<"purchaseDate" | "installDate" | "warrantyEnd", string | null>> = {};
    for (const k of ["purchaseDate", "installDate", "warrantyEnd"] as const) {
      const d = parseDateCell(r.cells[k]);
      if (d === "invalid") errors.push(`${IMPORT_COLUMNS.find((c) => c.key === k)?.header} "${values[k]}" is not a date (use YYYY-MM-DD).`);
      else { dates[k] = d; if (d) values[k] = d; }
    }
    if (dates.purchaseDate && dates.installDate && dates.installDate < dates.purchaseDate) errors.push("Install date is before the purchase date.");

    let warrantyMonths: number | null = null;
    if (t("warrantyMonths")) {
      const n = Number(t("warrantyMonths"));
      if (!Number.isInteger(n) || n < 0 || n > 240) errors.push("Warranty months must be a whole number between 0 and 240.");
      else warrantyMonths = n;
    }
    let purchaseCost: number | null = null;
    if (t("purchaseCost")) {
      const n = Number(String(t("purchaseCost")).replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) errors.push(`Purchase cost "${t("purchaseCost")}" is not a number.`);
      else purchaseCost = n;
    }
    const currency = t("currency")?.toUpperCase() ?? null;
    if (currency && !/^[A-Z]{3}$/.test(currency)) errors.push(`Currency "${currency}" must be a 3-letter code.`);

    const valid: ValidRow | null = errors.length || !dt ? null : {
      rowNumber: r.rowNumber, deviceTypeId: dt.id, deviceTypeCode: code as string, roomId, departmentId,
      manufacturer: t("manufacturer"), model: t("model"), serialNumber: serial,
      status, condition,
      purchaseDate: dates.purchaseDate ?? null, installDate: dates.installDate ?? null,
      warrantyMonths, warrantyEnd: dates.warrantyEnd ?? null,
      purchaseCost, currency: currency ?? (purchaseCost != null ? "USD" : null), notes: t("notes"),
    };
    rows.push({ rowNumber: r.rowNumber, values, errors, valid });
  }
  return { rows, valid: rows.flatMap((r) => (r.valid ? [r.valid] : [])) };
}

/** Effective warranty end for a valid row (same rule as the asset factory), for previews. */
export function previewWarrantyEnd(r: Pick<ValidRow, "warrantyEnd" | "warrantyMonths" | "installDate" | "purchaseDate">): string | null {
  if (r.warrantyEnd) return r.warrantyEnd;
  const start = r.installDate ?? r.purchaseDate;
  return start && r.warrantyMonths ? addMonths(start, r.warrantyMonths) : null;
}
