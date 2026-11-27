/**
 * Device network and security details (wave 25): labels and the plain checks that turn a record into a short list
 * of concerns. The fields follow the questions of the manufacturer's security statement (MDS2) that a hospital
 * can answer itself. Pure.
 */
import { addMonths } from "./dates";

export const CONNECTIONS = ["NONE", "WIRED", "WIRELESS", "BOTH"] as const;
export const TRI = ["YES", "NO", "UNKNOWN"] as const;
export const REMOTE = ["NONE", "SUPPLIER", "HOSPITAL", "BOTH"] as const;
export type Connection = (typeof CONNECTIONS)[number];
export type Tri = (typeof TRI)[number];
export type Remote = (typeof REMOTE)[number];

export const CONNECTION_LABELS: Record<Connection, string> = { NONE: "Not on the network", WIRED: "Cable", WIRELESS: "Wi-Fi", BOTH: "Cable and Wi-Fi" };
export const TRI_LABELS: Record<Tri, string> = { YES: "Yes", NO: "No", UNKNOWN: "Not known" };
export const REMOTE_LABELS: Record<Remote, string> = { NONE: "None", SUPPLIER: "Supplier", HOSPITAL: "Hospital IT", BOTH: "Supplier and hospital IT" };

export type SecurityRecord = {
  connection: Connection; operatingSystem: string | null; osSupportEnds: string | null;
  storesPatientData: Tri; sendsPatientData: Tri; encrypted: Tri; antiMalware: Tri; defaultPasswordsChanged: Tri;
  remoteAccess: Remote; lastPatchedOn: string | null; mds2OnFile: boolean; reviewedOn: string | null;
};

export type Concern = { level: "high" | "medium"; text: string };


/** What needs attention on this device, worst first. A device that isn't on the network and holds no patient data has none. */
export function concerns(r: SecurityRecord, today: string): Concern[] {
  const out: Concern[] = [];
  const online = r.connection !== "NONE", patient = r.storesPatientData === "YES" || r.sendsPatientData === "YES";
  if (!online && !patient) return out;
  if (online && r.osSupportEnds && r.osSupportEnds < today) out.push({ level: "high", text: "The operating system no longer gets security fixes." });
  if (online && r.defaultPasswordsChanged === "NO") out.push({ level: "high", text: "Still has the factory passwords." });
  if (r.storesPatientData === "YES" && r.encrypted === "NO") out.push({ level: "high", text: "Holds patient data that isn't encrypted." });
  if (online && r.antiMalware === "NO") out.push({ level: "medium", text: "No protection against malware." });
  if (online && (!r.lastPatchedOn || addMonths(r.lastPatchedOn, 12) < today)) out.push({ level: "medium", text: r.lastPatchedOn ? "No security update in over a year." : "No security update on record." });
  if (online && r.osSupportEnds && r.osSupportEnds >= today && r.osSupportEnds < addMonths(today, 12)) out.push({ level: "medium", text: "Operating system support ends within a year." });
  if (online && (r.remoteAccess === "SUPPLIER" || r.remoteAccess === "BOTH") && r.defaultPasswordsChanged !== "YES") out.push({ level: "medium", text: "The supplier can connect from outside and the passwords aren't confirmed changed." });
  if (!r.mds2OnFile) out.push({ level: "medium", text: "The manufacturer's security statement (MDS2) isn't on file." });
  if (!r.reviewedOn || addMonths(r.reviewedOn, 12) < today) out.push({ level: "medium", text: r.reviewedOn ? "Not reviewed in over a year." : "Never reviewed." });
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "high" ? -1 : 1));
}

export const worst = (c: Concern[]): "high" | "medium" | "none" => (c.some((x) => x.level === "high") ? "high" : c.length ? "medium" : "none");

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
/** A problem with a typed network address, in words, or null. IPv6 is accepted loosely. */
export function addressProblem(ip: string | null | undefined, mac: string | null | undefined): { ipAddress?: string; macAddress?: string } | null {
  const out: { ipAddress?: string; macAddress?: string } = {};
  if (ip && !IPV4.test(ip) && !/^[0-9a-fA-F:]{3,45}$/.test(ip)) out.ipAddress = "Enter an IP address such as 10.20.4.17.";
  if (mac && !/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(mac)) out.macAddress = "Enter a MAC address such as 00:1A:2B:3C:4D:5E.";
  return Object.keys(out).length ? out : null;
}
export const tidyMac = (mac: string) => mac.toUpperCase().replace(/-/g, ":");

/* ── Wave 41: IEC 80001-1:2021 extras, SBOM, supplier remote access, legacy devices (ECRI 2026 #8) ── */

/** What the extra records say about one device, gathered by the server. */
export type SecurityExtras = {
  /** The make and model has an SBOM file on record. Null = the device isn't linked to a catalogue model. */
  sbomOnFile: boolean | null;
  /** Key components whose support has ended (from the model's SBOM list). */
  unsupportedComponents: string[];
  /** The supplier's remote-access agreement: its expiry date, "none" when no agreement is on file. Null = no expiry. */
  remoteAgreement: { onFile: boolean; expiresOn: string | null };
  /** Network risks: open ones with a high residual risk, and ones whose review date has passed. */
  highResidual: number; reviewOverdue: number; risks: number;
};

/** The extra concerns, in the same form as `concerns`. Only for a device on the network. */
export function extraConcerns(r: Pick<SecurityRecord, "connection" | "remoteAccess">, e: SecurityExtras, today: string): Concern[] {
  const out: Concern[] = [];
  if (r.connection === "NONE") return out;
  const supplier = r.remoteAccess === "SUPPLIER" || r.remoteAccess === "BOTH";
  if (supplier && !e.remoteAgreement.onFile) out.push({ level: "high", text: "The supplier connects from outside with no remote-access agreement on file." });
  else if (supplier && e.remoteAgreement.expiresOn && e.remoteAgreement.expiresOn < today) out.push({ level: "high", text: "The supplier's remote-access agreement has expired." });
  else if (supplier && e.remoteAgreement.expiresOn && e.remoteAgreement.expiresOn < addMonths(today, 2)) out.push({ level: "medium", text: "The supplier's remote-access agreement expires within two months." });
  if (e.highResidual) out.push({ level: "high", text: `${e.highResidual} network risk${e.highResidual === 1 ? "" : "s"} still high after the controls.` });
  if (e.reviewOverdue) out.push({ level: "medium", text: `${e.reviewOverdue} network risk${e.reviewOverdue === 1 ? " is" : "s are"} past the review date.` });
  if (!e.risks) out.push({ level: "medium", text: "No network risk recorded for its connections (IEC 80001-1)." });
  if (e.sbomOnFile === false) out.push({ level: "medium", text: "No software bill of materials (SBOM) on file for this model." });
  if (e.unsupportedComponents.length) out.push({ level: "medium", text: `Software no longer supported: ${e.unsupportedComponents.slice(0, 3).join(", ")}${e.unsupportedComponents.length > 3 ? "…" : ""}.` });
  return out;
}

/** Whole months from `from` to `today` (0 when `from` is later). */
export function monthsSince(from: string, today: string): number {
  const [y1, m1, d1] = from.split("-").map(Number), [y2, m2, d2] = today.split("-").map(Number);
  const n = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  return Math.max(0, n);
}

/**
 * The security facts the replacement score uses (ECRI 2026 hazard #8, legacy devices): only for devices on the
 * network. `monthsWithoutPatch` is null when the record has no update date (counted as no record, not as a gap).
 */
export function legacyFacts(r: Pick<SecurityRecord, "connection" | "osSupportEnds" | "lastPatchedOn"> | null | undefined, today: string): { osUnsupported: boolean; monthsWithoutPatch: number | null } {
  if (!r || r.connection === "NONE") return { osUnsupported: false, monthsWithoutPatch: null };
  return { osUnsupported: !!r.osSupportEnds && r.osSupportEnds < today, monthsWithoutPatch: r.lastPatchedOn ? monthsSince(r.lastPatchedOn, today) : null };
}
