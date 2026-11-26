import "server-only";
import { assets } from "@/db/schema";
import { bookValues } from "@/lib/assets/depreciation-server";
import { DEPRECIATION_METHOD_LABELS } from "@/lib/assets/depreciation";
import { formatMoney } from "@/lib/format";
import { getSetting } from "@/lib/settings";
import { plural } from "./calc";
import { EGP_NOTE, facilityCond, missingRatesNote } from "./shared";
import type { ReportContext, ReportResult, Row } from "./types";

const dayBefore = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

/**
 * Depreciation journal (wave 29): the depreciation charge of each device in the period, as journal lines for the
 * finance system: debit depreciation expense, credit accumulated depreciation. Charge = written off by the end of
 * the period − written off by the day before it starts.
 */
export async function depreciationJournalReport({ filters: f, scope, today }: ReportContext): Promise<ReportResult> {
  const from = f.from ?? `${today.slice(0, 7)}-01`, to = f.to ?? today;
  const where = facilityCond(assets.facilityId, f, scope);
  const [end, start, method] = await Promise.all([bookValues(where, to, true), bookValues(where, dayBefore(from), true), getSetting("depreciationMethod")]);
  const before = new Map(start.rows.map((r) => [r.id, r]));
  const rows: Row[] = [];
  let egp = 0;
  for (const r of end.rows) {
    const b = before.get(r.id);
    const charge = (r.dep.accumulated ?? 0) - (b?.dep.accumulated ?? 0);
    if (!(charge > 0.004)) continue;
    const chargeEgp = r.accumulatedEgp != null ? r.accumulatedEgp - (b?.accumulatedEgp ?? 0) : null;
    if (chargeEgp != null) egp += chargeEgp;
    rows.push({
      id: r.id, date: to, tag: r.tag, typeName: r.typeName, facility: r.facility, department: r.department ?? "—",
      debit: "Depreciation expense: medical equipment", credit: "Accumulated depreciation: medical equipment",
      amount: Math.round(charge * 100) / 100, currency: r.currency, amountEgp: chargeEgp != null ? Math.round(chargeEgp * 100) / 100 : null,
      bookValue: r.dep.bookValue, memo: `Depreciation ${from} to ${to}, ${r.tag}`,
    });
  }
  rows.sort((a, b) => String(a.facility).localeCompare(String(b.facility)) || String(a.department).localeCompare(String(b.department)) || String(a.tag).localeCompare(String(b.tag)));
  return {
    summary: [
      { label: "Journal lines", value: String(rows.length) },
      { label: "Charge for the period", value: formatMoney(egp, "EGP"), money: true },
      { label: "Method", value: DEPRECIATION_METHOD_LABELS[method].split(" (")[0] },
    ],
    sections: [{
      key: "journal",
      columns: [
        { key: "date", header: "Date", type: "date", width: 12 },
        { key: "tag", header: "Device", width: 20, mono: true, subKey: "typeName", href: (r) => `/assets/${r.id}` },
        { key: "typeName", header: "Device type", width: 30, only: "excel" },
        { key: "facility", header: "Facility", width: 24 },
        { key: "department", header: "Department", width: 24 },
        { key: "debit", header: "Debit", width: 34 },
        { key: "credit", header: "Credit", width: 38 },
        { key: "amount", header: "Amount", type: "money", width: 14 },
        { key: "currency", header: "Currency", width: 8 },
        { key: "amountEgp", header: "Amount (EGP)", type: "money", width: 14 },
        { key: "bookValue", header: "Book value after", type: "money", width: 16, only: "excel" },
        { key: "memo", header: "Memo", width: 40, only: "excel" },
      ],
      rows, totals: rows.length ? { tag: plural(rows.length, "line"), amountEgp: Math.round(egp * 100) / 100 } : undefined,
      empty: "Nothing was written off in this period: no device with a cost, a start date and a useful life was depreciating.",
    }],
    notes: [
      `Charge = what was written off by ${to} minus what was written off by the day before ${from}, with the hospital's method (${DEPRECIATION_METHOD_LABELS[method].toLowerCase()}; Administration › Settings).`,
      "The account names are placeholders: rename the columns to your chart of accounts when you import the Excel file.",
      EGP_NOTE, missingRatesNote(end.missing),
    ].filter((n): n is string => !!n),
  };
}
