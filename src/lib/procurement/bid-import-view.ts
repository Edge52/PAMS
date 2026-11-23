/**
 * What the "Import a bid from Excel" panel shows after checking a file (wave 38). Pure; built on the server so
 * prices never reach a browser whose user may not see them (prices.view) or while a two-envelope tender is sealed.
 */
import type { BidCheck, Issue, TemplateLine } from "./bid-import";

export type BidPreviewLine = {
  code: string; name: string; quantity: number; unitPrice: number | null; discountPct: number | null;
  make: string | null; model: string | null; origin: string | null; deliveryWeeks: number | null; warrantyMonths: number | null;
  answered: number; specItems: number; mandatoryNo: number;
};
export type BidPreview = {
  supplier: string; reference: string | null; offerDate: string | null; validUntil: string | null; currency: string | null; incoterm: string | null;
  lines: BidPreviewLine[]; notQuoted: string[]; errors: Issue[]; warnings: Issue[];
  /** Prices are shown only to people with prices.view, and not while the tender is sealed. */
  pricesShown: boolean; pricesNote: string | null;
  /** The offer an import would replace, if any. */
  replaces: string | null;
};

export type BidImportState = {
  errors?: string[]; message?: string;
  preview?: BidPreview;
  /** True when the last step saved the bid. */
  imported?: boolean;
} | null;

export function bidPreview(check: BidCheck, o: { supplier: string; lines: TemplateLine[]; showPrices: boolean; sealed: boolean; replaces: string | null }): BidPreview {
  const pricesShown = o.showPrices && !o.sealed;
  const mandatory = new Map(o.lines.map((l) => [l.code, new Set(l.specItems.filter((s) => s.mandatory).map((s) => s.id))]));
  return {
    supplier: o.supplier, reference: check.header?.reference ?? null, offerDate: check.header?.offerDate ?? null, validUntil: check.header?.validUntil ?? null,
    currency: check.header?.currency ?? null, incoterm: check.header?.incoterm ?? null,
    lines: check.lines.map((l) => ({
      code: l.code, name: l.name, quantity: l.quantity, unitPrice: pricesShown ? l.unitPrice : null, discountPct: pricesShown ? l.discountPct : null,
      make: l.manufacturer, model: l.model, origin: l.countryOfOrigin, deliveryWeeks: l.deliveryWeeks, warrantyMonths: l.warrantyMonths,
      answered: l.compliance.filter((c) => c.status !== "NOT_STATED").length,
      specItems: o.lines.find((x) => x.code === l.code)?.specItems.length ?? 0,
      mandatoryNo: l.compliance.filter((c) => c.status === "NOT_COMPLIANT" && mandatory.get(l.code)?.has(c.specItemId)).length,
    })),
    notQuoted: check.notQuoted, errors: check.errors, warnings: check.warnings,
    pricesShown,
    pricesNote: pricesShown ? null : o.sealed ? "Prices are read but not shown: the financial envelopes of this tender are still sealed." : "Prices are read but not shown: your role doesn't see supplier prices.",
    replaces: o.replaces,
  };
}
