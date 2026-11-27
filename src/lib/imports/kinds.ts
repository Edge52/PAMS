/**
 * More CSV / Excel imports (wave 41): suppliers, service contracts, users, PPM schedules and spare parts. Pure: the
 * columns of each template and the row checks. The server (kinds-server.ts) supplies the lookups and writes the rows.
 */
import { ROLE_LABELS, ROLES, type Role } from "../auth/permissions";
import { cellText, dateCell, EMAIL, enumCell, ISO_CURRENCY, numberCell, shownValues, textCell, yesNoCell, type Column, type RowResult } from "./table";

export const IMPORT_KINDS = ["suppliers", "contracts", "users", "ppm", "parts"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

const SUPPLIER_TYPES = ["MANUFACTURER", "DISTRIBUTOR", "AGENT", "SERVICE_PROVIDER"] as const;
const CONTRACT_TYPES = ["FULL_SERVICE", "PREVENTIVE", "PARTS_ONLY", "LABOUR_ONLY", "WARRANTY_EXTENSION"] as const;
const VISIT_TYPES = ["PPM", "CALIBRATION", "INSPECTION", "SAFETY_TEST"] as const;

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
/** "a, b; c" → ["a", "b", "c"] */
export const splitList = (s: string) => s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);

/* ── Suppliers ── */

export const SUPPLIER_COLUMNS: Column[] = [
  { key: "name", header: "Supplier name", required: true, hint: "The company's name as on its commercial register", example: "Nile Medical Systems" },
  { key: "type", header: "Type", hint: "Manufacturer, Distributor, Agent or Service provider. Blank: distributor", example: "Agent" },
  { key: "country", header: "Country", hint: "Country of the company", example: "Egypt" },
  { key: "brands", header: "Brands", hint: "Brands it sells or services, separated by commas", example: "Philips, Mindray" },
  { key: "contactName", header: "Contact name", hint: "Main contact", example: "Ahmed Samir" },
  { key: "email", header: "Email", hint: "Main email address", example: "sales@nilemed.example" },
  { key: "phone", header: "Phone", hint: "Main phone", example: "+20 2 2345 6789" },
  { key: "address", header: "Address", hint: "Postal address", example: "12 Tahrir St, Cairo" },
  { key: "taxId", header: "Tax ID", hint: "Tax registration number", example: "123-456-789" },
  { key: "commercialRegister", header: "Commercial register", hint: "Commercial register number", example: "98765" },
  { key: "notes", header: "Notes", hint: "Free text", example: "" },
];
export type SupplierRow = { name: string; type: (typeof SUPPLIER_TYPES)[number]; country: string | null; brands: string[]; contactName: string | null; email: string | null;
  phone: string | null; address: string | null; taxId: string | null; commercialRegister: string | null; notes: string | null };

export function checkSupplier(c: Record<string, unknown>, existing: Set<string>, seen: Set<string>): { value: SupplierRow | null; errors: string[] } {
  const e: string[] = [];
  const name = textCell(c.name, "Supplier name", e, 200, true);
  if (name && existing.has(key(name))) e.push(`${name} is already a supplier.`);
  else if (name && seen.has(key(name))) e.push(`${name} is twice in the file.`);
  const type = enumCell(c.type, "Type", SUPPLIER_TYPES, e, { MANUFACTURER: "Manufacturer", DISTRIBUTOR: "Distributor", AGENT: "Agent", SERVICE_PROVIDER: "Service provider" });
  const email = textCell(c.email, "Email", e, 255);
  if (email && !EMAIL.test(email)) e.push("Email is not a valid address.");
  const v: SupplierRow = {
    name: name ?? "", type: type ?? "DISTRIBUTOR", country: textCell(c.country, "Country", e, 80), brands: splitList(cellText(c.brands)).slice(0, 50),
    contactName: textCell(c.contactName, "Contact name", e, 120), email, phone: textCell(c.phone, "Phone", e, 64), address: textCell(c.address, "Address", e, 500),
    taxId: textCell(c.taxId, "Tax ID", e, 64), commercialRegister: textCell(c.commercialRegister, "Commercial register", e, 64), notes: textCell(c.notes, "Notes", e, 2000),
  };
  if (name && !e.length) seen.add(key(name));
  return { value: e.length ? null : v, errors: e };
}

/* ── Service contracts ── */

export const CONTRACT_COLUMNS: Column[] = [
  { key: "supplier", header: "Supplier", required: true, hint: "Supplier name exactly as in PAMS (import suppliers first)", example: "Nile Medical Systems" },
  { key: "title", header: "Title", required: true, hint: "What the contract covers", example: "CT scanner full service 2027" },
  { key: "type", header: "Type", hint: "Full service, Preventive, Parts only, Labour only, Warranty extension. Blank: full service", example: "Full service" },
  { key: "vendorReference", header: "Supplier's reference", hint: "The contract number on the supplier's side", example: "NMS-SC-0042" },
  { key: "startDate", header: "Start date", required: true, hint: "YYYY-MM-DD or an Excel date", example: "2027-01-01" },
  { key: "endDate", header: "End date", required: true, hint: "YYYY-MM-DD or an Excel date", example: "2027-12-31" },
  { key: "value", header: "Value", hint: "Contract value, number only (only people who may see prices can import it)", example: 450000 },
  { key: "currency", header: "Currency", hint: "ISO code, e.g. EGP, USD", example: "EGP" },
  { key: "responseHours", header: "Response hours", hint: "Promised on-site response, hours", example: 4 },
  { key: "repairHours", header: "Repair hours", hint: "Promised repair time, hours", example: 48 },
  { key: "uptimePct", header: "Uptime %", hint: "Guaranteed uptime, e.g. 95", example: 95 },
  { key: "ppmVisitsPerYear", header: "PPM visits a year", hint: "Planned visits a year", example: 4 },
  { key: "includesParts", header: "Includes parts", hint: "Yes or No", example: "Yes" },
  { key: "contactName", header: "Contact name", hint: "Supplier's service contact", example: "Service desk" },
  { key: "contactPhone", header: "Contact phone", hint: "Service phone", example: "+20 2 1234 5678" },
  { key: "assetTags", header: "Asset tags", hint: "Tags of the devices covered, separated by commas", example: "DGH-CT-000001" },
  { key: "notes", header: "Notes", hint: "Free text", example: "" },
];
export type ContractRow = {
  supplierId: number; title: string; type: (typeof CONTRACT_TYPES)[number]; vendorReference: string | null; startDate: string; endDate: string;
  value: number | null; currency: string | null; responseHours: number | null; repairHours: number | null; uptimePct: number | null; ppmVisitsPerYear: number | null;
  includesParts: boolean; contactName: string | null; contactPhone: string | null; assetIds: number[]; notes: string | null;
};
export type ContractLookups = { suppliers: Map<string, number>; assets: Map<string, number>; prices: boolean };

export function checkContract(c: Record<string, unknown>, lk: ContractLookups): { value: ContractRow | null; errors: string[]; warnings: string[] } {
  const e: string[] = [], w: string[] = [];
  const supplier = textCell(c.supplier, "Supplier", e, 200, true);
  const supplierId = supplier ? lk.suppliers.get(key(supplier)) : undefined;
  if (supplier && !supplierId) e.push(`Supplier "${supplier}" is not in PAMS. Import or add it first.`);
  const title = textCell(c.title, "Title", e, 300, true);
  const type = enumCell(c.type, "Type", CONTRACT_TYPES, e, { FULL_SERVICE: "Full service", PREVENTIVE: "Preventive", PARTS_ONLY: "Parts only", LABOUR_ONLY: "Labour only", WARRANTY_EXTENSION: "Warranty extension" });
  const startDate = dateCell(c.startDate, "Start date", e, true), endDate = dateCell(c.endDate, "End date", e, true);
  if (startDate && endDate && endDate < startDate) e.push("The end date is before the start date.");
  let value = numberCell(c.value, "Value", e, { min: 0, max: 1e11 });
  if (value != null && !lk.prices) { w.push("Value left out: only people who may see prices can import it."); value = null; }
  const currency = textCell(c.currency, "Currency", e, 3)?.toUpperCase() ?? null;
  if (currency && !ISO_CURRENCY.test(currency)) e.push("Currency must be a three-letter code such as EGP.");
  const tags = splitList(cellText(c.assetTags)).map((t) => t.toUpperCase());
  const assetIds: number[] = [];
  for (const t of tags) { const id = lk.assets.get(t); if (id) assetIds.push(id); else e.push(`No device ${t} in this hospital.`); }
  const v: ContractRow = {
    supplierId: supplierId ?? 0, title: title ?? "", type: type ?? "FULL_SERVICE", vendorReference: textCell(c.vendorReference, "Supplier's reference", e, 120),
    startDate: startDate ?? "", endDate: endDate ?? "", value, currency: value != null ? currency ?? "EGP" : currency,
    responseHours: numberCell(c.responseHours, "Response hours", e, { min: 0, max: 10000, int: true }),
    repairHours: numberCell(c.repairHours, "Repair hours", e, { min: 0, max: 10000, int: true }),
    uptimePct: numberCell(c.uptimePct, "Uptime %", e, { min: 0, max: 100 }),
    ppmVisitsPerYear: numberCell(c.ppmVisitsPerYear, "PPM visits a year", e, { min: 0, max: 52, int: true }),
    includesParts: yesNoCell(c.includesParts, "Includes parts", e), contactName: textCell(c.contactName, "Contact name", e, 120),
    contactPhone: textCell(c.contactPhone, "Contact phone", e, 48), assetIds: [...new Set(assetIds)], notes: textCell(c.notes, "Notes", e, 2000),
  };
  return { value: e.length ? null : v, errors: e, warnings: w };
}

/* ── Users (no passwords) ── */

export const USER_COLUMNS: Column[] = [
  { key: "name", header: "Name", required: true, hint: "Full name", example: "Mona Adel" },
  { key: "email", header: "Email", required: true, hint: "Work email; it is the sign-in name", example: "mona.adel@hospital.example" },
  { key: "role", header: "Role", required: true, hint: `One of: ${ROLES.map((r) => ROLE_LABELS[r]).join(", ")}`, example: "Biomedical engineer" },
  { key: "jobTitle", header: "Job title", hint: "Shown beside the name", example: "Biomedical engineer" },
  { key: "phone", header: "Phone", hint: "Mobile number", example: "+20 100 123 4567" },
  { key: "hospitals", header: "Hospitals", hint: "Hospital codes separated by commas. Blank: every hospital", example: "DGH" },
];
export type UserRow = { name: string; email: string; role: Role; jobTitle: string | null; phone: string | null; facilityIds: number[] | null };

export function checkUser(c: Record<string, unknown>, lk: { emails: Set<string>; facilities: Map<string, number> }, seen: Set<string>): { value: UserRow | null; errors: string[] } {
  const e: string[] = [];
  const name = textCell(c.name, "Name", e, 120, true);
  const email = textCell(c.email, "Email", e, 255, true)?.toLowerCase() ?? null;
  if (email && !EMAIL.test(email)) e.push("Email is not a valid address.");
  else if (email && lk.emails.has(email)) e.push(`${email} already has an account.`);
  else if (email && seen.has(email)) e.push(`${email} is twice in the file.`);
  const role = enumCell(c.role, "Role", ROLES, e, ROLE_LABELS);
  if (!role && !e.some((x) => x.startsWith("Role"))) e.push("Role is required.");
  const codes = splitList(cellText(c.hospitals)).map((x) => x.toUpperCase());
  const facilityIds = codes.map((code) => { const id = lk.facilities.get(code); if (!id) e.push(`No hospital with the code ${code}.`); return id ?? 0; });
  const v: UserRow = { name: name ?? "", email: email ?? "", role: role ?? "VIEWER", jobTitle: textCell(c.jobTitle, "Job title", e, 120), phone: textCell(c.phone, "Phone", e, 32),
    facilityIds: codes.length && role !== "ADMIN" ? facilityIds : null };
  if (email && !e.length) seen.add(email);
  return { value: e.length ? null : v, errors: e };
}

/* ── PPM schedules ── */

export const PPM_COLUMNS: Column[] = [
  { key: "assetTag", header: "Asset tag", required: true, hint: "The device's tag, e.g. DGH-MON-000042", example: "DGH-MON-000042", aliases: ["tag"] },
  { key: "type", header: "Visit type", hint: "PPM, Calibration, Inspection or Safety test. Blank: PPM", example: "PPM" },
  { key: "scheduledDate", header: "Due date", required: true, hint: "YYYY-MM-DD or an Excel date", example: "2027-02-15", aliases: ["scheduled date", "date"] },
  { key: "vendor", header: "Done by (supplier)", hint: "Supplier name when a supplier does the visit; blank for in-house", example: "" },
  { key: "notes", header: "Notes", hint: "What to do on the visit", example: "Quarterly PPM" },
];
export type PpmRow = { assetId: number; type: (typeof VISIT_TYPES)[number]; scheduledDate: string; vendorId: number | null; notes: string | null };
export type PpmLookups = { assets: Map<string, { id: number; disposed: boolean }>; suppliers: Map<string, number>; existing: Set<string> };

export function checkPpm(c: Record<string, unknown>, lk: PpmLookups, seen: Set<string>, today: string): { value: PpmRow | null; errors: string[]; warnings: string[] } {
  const e: string[] = [], w: string[] = [];
  const tag = textCell(c.assetTag, "Asset tag", e, 48, true)?.toUpperCase() ?? null;
  const a = tag ? lk.assets.get(tag) : undefined;
  if (tag && !a) e.push(`No device ${tag} in this hospital.`);
  else if (a?.disposed) e.push(`${tag} has been disposed of.`);
  const type = enumCell(c.type, "Visit type", VISIT_TYPES, e, { PPM: "PPM", CALIBRATION: "Calibration", INSPECTION: "Inspection", SAFETY_TEST: "Safety test" }) ?? "PPM";
  const date = dateCell(c.scheduledDate, "Due date", e, true);
  if (date && date < today) w.push("The due date has passed: the visit shows as overdue.");
  const vendor = textCell(c.vendor, "Done by (supplier)", e, 200);
  const vendorId = vendor ? lk.suppliers.get(key(vendor)) ?? null : null;
  if (vendor && !vendorId) e.push(`Supplier "${vendor}" is not in PAMS.`);
  const k = a && date ? `${a.id}|${type}|${date}` : null;
  if (k && lk.existing.has(k)) e.push("That visit is already scheduled.");
  else if (k && seen.has(k)) e.push("That visit is twice in the file.");
  if (k && !e.length) seen.add(k);
  return { value: e.length || !a || !date ? null : { assetId: a.id, type, scheduledDate: date, vendorId, notes: textCell(c.notes, "Notes", e, 2000) }, errors: e, warnings: w };
}

/* ── Spare parts ── */

export const PART_COLUMNS: Column[] = [
  { key: "partNumber", header: "Part number", required: true, hint: "The maker's part number; unique in the hospital's store", example: "M1191B", aliases: ["part no", "pn"] },
  { key: "name", header: "Part name", required: true, hint: "What it is", example: "SpO2 sensor, adult, reusable" },
  { key: "manufacturer", header: "Manufacturer", hint: "Maker of the part", example: "Philips" },
  { key: "deviceTypeCode", header: "Fits device type", hint: "Device type code; blank for general use", example: "MON-PAT-HIGH" },
  { key: "supplier", header: "Supplier", hint: "Supplier name as in PAMS", example: "Nile Medical Systems" },
  { key: "unitCost", header: "Unit cost", hint: "Number only (only people who may see prices can import it)", example: 1200 },
  { key: "currency", header: "Currency", hint: "ISO code", example: "EGP" },
  { key: "stockQty", header: "In stock", hint: "Count now in the store; booked as a stock receipt", example: 6 },
  { key: "minQty", header: "Minimum", hint: "Reorder at or below this", example: 2 },
  { key: "location", header: "Location", hint: "Shelf or bin", example: "Store B, shelf 3" },
];
export type PartRow = { partNumber: string; name: string; manufacturer: string | null; deviceTypeId: number | null; supplierId: number | null; unitCost: number | null;
  currency: string | null; stockQty: number; minQty: number; location: string | null };
export type PartLookups = { existing: Set<string>; deviceTypes: Map<string, number>; suppliers: Map<string, number>; prices: boolean };

export function checkPart(c: Record<string, unknown>, lk: PartLookups, seen: Set<string>): { value: PartRow | null; errors: string[]; warnings: string[] } {
  const e: string[] = [], w: string[] = [];
  const pn = textCell(c.partNumber, "Part number", e, 64, true);
  if (pn && lk.existing.has(pn.toUpperCase())) e.push(`Part ${pn} is already in this store.`);
  else if (pn && seen.has(pn.toUpperCase())) e.push(`Part ${pn} is twice in the file.`);
  const code = textCell(c.deviceTypeCode, "Fits device type", e, 48)?.toUpperCase();
  const deviceTypeId = code ? lk.deviceTypes.get(code) ?? null : null;
  if (code && !deviceTypeId) e.push(`No device type ${code} in the catalogue.`);
  const supplier = textCell(c.supplier, "Supplier", e, 200);
  const supplierId = supplier ? lk.suppliers.get(key(supplier)) ?? null : null;
  if (supplier && !supplierId) e.push(`Supplier "${supplier}" is not in PAMS.`);
  let unitCost = numberCell(c.unitCost, "Unit cost", e, { min: 0, max: 1e9 });
  if (unitCost != null && !lk.prices) { w.push("Unit cost left out: only people who may see prices can import it."); unitCost = null; }
  const currency = textCell(c.currency, "Currency", e, 3)?.toUpperCase() ?? null;
  if (currency && !ISO_CURRENCY.test(currency)) e.push("Currency must be a three-letter code such as EGP.");
  const v: PartRow = {
    partNumber: pn ?? "", name: textCell(c.name, "Part name", e, 200, true) ?? "", manufacturer: textCell(c.manufacturer, "Manufacturer", e, 120), deviceTypeId, supplierId,
    unitCost, currency: unitCost != null ? currency ?? "EGP" : null,
    stockQty: numberCell(c.stockQty, "In stock", e, { min: 0, max: 1e6, int: true }) ?? 0, minQty: numberCell(c.minQty, "Minimum", e, { min: 0, max: 1e6, int: true }) ?? 0,
    location: textCell(c.location, "Location", e, 120),
  };
  if (pn && !e.length) seen.add(pn.toUpperCase());
  return { value: e.length ? null : v, errors: e, warnings: w };
}

/* ── Kinds ── */

export const KIND_INFO: Record<ImportKind, { title: string; what: string; columns: Column[]; perHospital: boolean; perm: "suppliers.edit" | "contracts.edit" | "users.manage" | "maintenance.edit" | "parts.edit"; href: string; label: string }> = {
  suppliers: { title: "Suppliers", what: "suppliers", columns: SUPPLIER_COLUMNS, perHospital: false, perm: "suppliers.edit", href: "/procurement/suppliers", label: "Open suppliers" },
  contracts: { title: "Service contracts", what: "contracts", columns: CONTRACT_COLUMNS, perHospital: true, perm: "contracts.edit", href: "/assets/contracts", label: "Open contracts" },
  users: { title: "Users", what: "users", columns: USER_COLUMNS, perHospital: false, perm: "users.manage", href: "/admin/users", label: "Open users" },
  ppm: { title: "PPM schedules", what: "visits", columns: PPM_COLUMNS, perHospital: true, perm: "maintenance.edit", href: "/assets/maintenance", label: "Open maintenance" },
  parts: { title: "Spare parts", what: "parts", columns: PART_COLUMNS, perHospital: true, perm: "parts.edit", href: "/assets/parts", label: "Open spare parts" },
};

/** Run a kind's check over every row, keeping the shown values for the report. */
export function runChecks<V>(raw: { rowNumber: number; cells: Record<string, unknown> }[], check: (c: Record<string, unknown>) => { value: V | null; errors: string[]; warnings?: string[] }): (RowResult<V> & { warnings: string[] })[] {
  return raw.map((r) => { const x = check(r.cells); return { rowNumber: r.rowNumber, values: shownValues(r.cells), errors: x.errors, warnings: x.warnings ?? [], value: x.value }; });
}
