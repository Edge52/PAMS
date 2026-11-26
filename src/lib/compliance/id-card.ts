/**
 * Equipment ID card (wave 40, GAHAR 2025 standards EFS.10 EOC 4): who to call when a device fails. Pure (tested).
 * The vendor's emergency line is the running service contract's phone, else the supplier's service contact, else
 * the one typed on the card, else the supplier's main phone.
 */

export type CardContract = { number: string; supplierName: string; contactName: string | null; contactPhone: string | null; endDate: string; startDate: string };
export type CardContact = { name: string; role: string; phone: string | null };

export type VendorLine = { phone: string | null; name: string | null; source: "contract" | "service_contact" | "card" | "supplier" | null };

/** The running contract on `today` (latest end date first), or null. */
export function runningContract<T extends { startDate: string; endDate: string }>(contracts: T[], today: string): T | null {
  return contracts.filter((c) => c.startDate <= today && c.endDate >= today).sort((a, b) => b.endDate.localeCompare(a.endDate))[0] ?? null;
}

export function vendorLine(o: {
  contract: CardContract | null; contacts: CardContact[]; cardPhone: string | null | undefined;
  supplier: { name: string; phone: string | null } | null;
}): VendorLine {
  if (o.contract?.contactPhone) return { phone: o.contract.contactPhone, name: o.contract.contactName ?? o.contract.supplierName, source: "contract" };
  const svc = o.contacts.find((c) => c.role === "SERVICE" && c.phone);
  if (svc) return { phone: svc.phone, name: svc.name, source: "service_contact" };
  if (o.cardPhone?.trim()) return { phone: o.cardPhone.trim(), name: o.supplier?.name ?? null, source: "card" };
  if (o.supplier?.phone) return { phone: o.supplier.phone, name: o.supplier.name, source: "supplier" };
  return { phone: null, name: o.supplier?.name ?? null, source: null };
}

export const VENDOR_SOURCE_LABELS: Record<NonNullable<VendorLine["source"]>, string> = {
  contract: "From the service contract", service_contact: "Supplier's service contact", card: "Typed on this card", supplier: "Supplier's main phone",
};

/** Plain phone check for typed numbers: digits, spaces, + - ( ) and "ext". */
export function phoneProblem(v: string | null | undefined): string | null {
  if (!v || !v.trim()) return null;
  return /^[+()0-9\s\-./]{4,40}(\s*(ext|x)\.?\s*\d{1,6})?$/i.test(v.trim()) ? null : "Enter a phone number (digits, spaces, + and -).";
}
