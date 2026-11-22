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
