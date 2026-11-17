# Wave 27 — finance (branch `wave-27-finance`)

## Changelog

- **Depreciation and book value.** Device types and single devices have a useful life (the existing life
  expectancy) and a residual value % (new; a device's own figures win over its type's). Straight-line
  depreciation from the in-service date: the signed acceptance date, else the install date, else the purchase
  date, counted by the day. The asset page has a **Book value** panel (cost, depreciation so far, book value
  today, years left, in the asset's currency and in EGP) beside Performance and cost, with a small form to set
  the device's own life and residual value. The catalogue page has a **Depreciation** panel for the type's
  defaults.
- **Book value report** (Reports › Money): cost, depreciation so far and book value by facility, department and
  device type, with totals, print and Excel.
- **Capital plan**: a "Book value now" column for the year's devices and a "Book value left" figure (what is
  still on the books on 1 January of the chosen year, written off if the devices are replaced).
- **Service cost and COSR report** (Reports › Money): service cost in the period (completed maintenance and
  repairs, which carry each work order's cost with parts, plus each service contract's share for the period
  split over its devices) against the devices' purchase cost, by device type, department and the supplier who
  supplied the device, split in-house vs contract and vendor. COSR in the period and per year, with the guide
  that under about 5–6 % a year is usually good value, stated as a guide, not a rule.
- **Budgets**: one EGP total at the stored exchange rates (with the share committed or spent and the amount
  spent), the per-currency figures kept, each non-EGP line shows its EGP amount, and the usual "no exchange
  rate stored" note.
- **Supplier documents**: attachments have an expiry date; supplier documents have their own types (EDA
  registration, ISO 13485, agency letter, commercial register, tax card, licence, certificate, other). The
  supplier page shows each document as valid, expiring (60 days) or expired, with a form to change its type or
  date. New page **Procurement › Supplier documents** lists documents expired or expiring in 30/60/90/180 days.
  A warning (never a block) shows on the offer page (award), the new purchase order page and a framework
  agreement (call-offs) when the supplier has an expired document. Procurement gets one notification per
  document 30 days before it expires.
- Demo data (`scripts/seed/finance.ts`): 10 % residual value on imaging types; 15 supplier documents with
  expiry dates (one expired, some expiring within 30 and 60 days). Text placeholders, not real files.

Not covered:
- No declining-balance or other depreciation method; no depreciation journal or ERP export.
- Spare parts used are counted only through the work order's cost (the cost field is pre-filled with the parts
  booked); parts issued without a cost on the job are not counted separately.
- Service cost by supplier means the supplier of the device, not the company that did the service.
- No reminder for documents that are already expired when they are added (they show on the pages instead).
- The demo's COSR is low (well under 1 %): the demo has few repair costs against expensive equipment.

## Agents

- Pure rules: `src/lib/assets/depreciation.ts` (`depreciation`, `depreciationTerms`, `inServiceDate`),
  `src/lib/reports/service-cost-calc.ts` (`contractShare`, `rollUp`, `cosrPct`, `yearlyCosr`, guide constants),
  `src/lib/procurement/supplier-docs.ts` (`docExpiry`, `expiringList`, `expiredWarning`, reminder key). Change a
  rule there with its test.
- DB side: `src/lib/assets/depreciation-server.ts` (`bookValues(where, onDate)` — EGP through `ratesFor` like the
  reports), `src/lib/procurement/supplier-docs-server.ts` (`supplierExpiryWarning` for any new place a PO or
  award is made).
- Migration `0043_finance` (renumber on merge): `device_types.residual_pct`, `assets.residual_pct` (checks 0–100,
  in `rules.test.ts`), `documents.expires_on` (indexed).
- `uploadDocument` reads an optional `expiresOn`; `DocumentUploadForm` takes `withExpiry`. The supplier page
  uses `SupplierDocumentsPanel` instead of `DocumentsPanel`.
- Alert `supplier_doc_expiring` (role PROCUREMENT, no facility), dedupe key
  `supplier_doc_expiring:<documentId>:<expiresOn>` — a renewed date gets one new reminder.
- Actions: `src/app/assets/depreciation-actions.ts` (type: `catalogue.edit`; device: `assets.edit` + facility),
  `src/app/procurement/suppliers/documents/actions.ts` (`suppliers.edit`). No new permissions.
- Reports group "Money" in `app/reports/page.tsx`; Finance sees it first.

## User guide

- **Book value of a device**: open the device; the Book value panel is on the right. To change its life or
  residual value, open "Change life or residual value for this device"; leave a field empty to use the device
  type's figure. Set the type's figures on its catalogue page (Depreciation).
- **Book value and COSR reports**: Reports › Money. Choose the hospital (and the period for COSR), then print or
  export to Excel. COSR per year under about 5–6 % is usually good value; it is a guide, not a rule.
- **Budgets in EGP**: Procurement › Budgets shows the year's total in EGP first, then each currency.
- **Supplier documents**: on the supplier page, attach the document, choose its type and the "Valid until"
  date. Use "Change type or date" to fix an existing one. Procurement › Supplier documents lists what has
  expired or expires soon. Procurement is notified 30 days before a document expires.
