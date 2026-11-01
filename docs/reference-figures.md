# Planning reference figures — review (wave 6)

The BOQ quick start, checks and cost tabs use reference figures: workload per scanner or room, equipment ranges per bed,
minimum room sizes, running costs and lead times. Each one was checked against published sources. Where a source
disagreed, the figure was changed. Where none exists, the figure is marked **judgement** (a planning assumption) for your
clinical and biomedical leads to confirm.

**Review sheet:** [`reference-figures-review.xlsx`](reference-figures-review.xlsx) lists all 105 figures with the value now
used, the value before the review, the status, the reasoning, the sources and where the app uses it. Fill in *Agreed value*
where you want a change and send it back. Rebuild it after any change with `npm run reference:sheet`. The register behind
it is `src/lib/boq/reference-figures.ts`, which reads the live values from the code.

## What changed

| Figure | Before | Now | Why |
|---|---|---|---|
| CT workload | 1 CT per 15,000 exams a year | **1 per 12,000** | Canadian national average 12,900 exams per CT unit (CDA-AMC, 2022–23). |
| X-ray room workload | 1 per 20,000 | **1 per 10,000** | US VA criteria: 4,370 a year on one 8-hour shift at 22 min an exam; digital rooms with extended hours reach about 10,000. |
| Endoscopy workload | 1 tower per 2,500 | **1 per 1,500** | 1,000–1,500 procedures a room a year; BSG: two rooms for 2,500–3,000 (NCEPOD 2004, WEO). |
| ICU ventilators (benchmark) | 0.5–1.2 per bed | **0.8–1.2** | Surveys and practice: about one per ICU bed plus spares. |
| ICU syringe pumps (benchmark) | 2–4 per bed | **3–6** | A level 3 patient often runs 3–8+ infusions. |
| MRI scan room | 40 m² | **30 m²** | 1.5 T vendor minimums ≈ 27–35 m² for the scan room alone. |
| Operating theatre | 36 m² | **37 m²** | FGI minimum 400 sq ft (37 m²); 600 sq ft (56 m²) for specialised theatres. |
| CT service cost | 10 % a year | **12 %** | Full OEM imaging service sits at the top of the 4.5–15 % range. |
| MRI service cost | 9 % | **10 %** | As above. |
| CT lead time | 8 months | **6** | 4–6 months into a ready room (20–32 weeks from specification). |
| Angiography lead time | 9 months | **8** | CT-like delivery plus ceiling-mounted fit-out. |

## Confirmed by sources (unchanged)

- MRI workload 1 per 6,000 a year (Canadian average 5,850).
- Delivery beds: 1 per 400 deliveries a year (a 16-hour stay at 75 % occupancy gives about 410).
- CT scan room ≥ 30 m², side ≥ 4.5 m.
- Cath lab ≥ 45 m² (codes: 37–42 m² minimum; the ACC recommends 46–56 m²).
- MRI lead time 10 months (6–12+ months with shielding).
- Maintenance rates for the other device groups, all within the published 4.5–15 % cost-of-service range.

## Still judgement: please confirm locally

- **Cath lab workload** (1,200 procedures a lab a year). The published figure is a minimum (200 PCI per institution), not a capacity.
- **Ultrasound** (6,000 a year per system) and **chemistry analyser** (400,000 tests a year) workloads.
- **Defibrillator ratios.** The standard is access within 3–5 minutes of collapse, so place them by layout.
- **Dialysis spare machines**, **CT and X-ray units per 100 beds**. No international benchmark exists (OECD).
- **Consumables, energy and service lives** per device group. Confirm the lives against the AHA *Estimated Useful Lives* guide (2023).
- **Other lead times** and the **30 % advance**. Use your suppliers' written delivery times and your payment terms.
- **Special-condition rules and companion items** in the quick start. These are clinical planning choices for your clinical leads.

## Main sources

- CDA-AMC, CT and MRI examination volumes in Canada (2022–23): <https://cda-amc.ca/sites/default/files/pdf/htis/2025/CM0016-Benchmarking_CT_exams.pdf>, <https://canjhealthtechnol.ca/index.php/cjht/article/view/CM0029>
- US VA space planning criteria, radiology: <https://vacriteria.tpub.com/7610-276/7610-2760019.htm>
- India NHM labour room guideline: <https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/Labor_Room%20Guideline.pdf>
- NCEPOD 2004, size of endoscopy units: <https://www.ncepod.org.uk/2004report/organisational.sizeofendoscopy.htm>; WEO endoscopy unit design: <https://www.worldendo.org/assets-craft/pdf/resources/guidelines/weo_guideline_designing_digestive_disease_endo_unit.pdf>
- SCAI cath lab best practices (2021): <https://scai.org/sites/default/files/2021-09/Best%20Practices%20in%20the%20CCL%2C%20An%20Update%2C%20Combined%20Slide%20Set%20(1).pdf>
- FGI-based operating room minimums (Oregon rule template): <https://www.oregon.gov/oha/ph/ProviderPartnerResources/HealthcareProvidersFacilities/FacilitiesPlanningSafety/Documents/FPSHospitalSurgicalFacilitiesRuleTemplate.pdf>; NHS HBN 26: <https://www.england.nhs.uk/wp-content/uploads/2021/05/HBN_26.pdf>
- Imaging room design (FGI clearances): <https://www.hfmmagazine.com/articles/1426-design-standards-for-imaging-areas-are-changing>; GE SIGNA Prime pre-installation manual: <https://latam.gehealthcare.com/content/dam/gehc/global/support/site-planning/documents/SIGNA-Prime-Preinstallation-Manual-PIM-5538858-1EN-6-ds-en.pdf>
- Cath lab design: <https://www.hmpgloballearningnetwork.com/site/cathlab/articles/Cardiac-Catheterization-Laboratory-Facility-Design-and-Equipment-Selection>
- Cost of service ratio: <https://24x7mag.com/maintenance-strategies/alternative-equipment-maintenance/maintenance-costs/examining-cosr-medical-equipment>; AORN on service contracts: <https://aorn.org/outpatient-surgery/article/2001-November-how-to-evaluate-an-equipment-service-contract>
- Capital equipment lead times: <https://auntminnie.com/practice-management/article/15584261/purchasing-capital-equipment-part-3-equipment-assessment>
- OECD Health at a Glance 2025, diagnostic technologies: <https://www.oecd.org/en/publications/health-at-a-glance-2025_8f9e3f98-en/full-report/diagnostic-technologies_9039027d.html>
- Resuscitation Council UK quality standards: <https://www.resus.org.uk/library/quality-standards-cpr/introduction-and-overview>
- ANZDATA haemodialysis capacity survey 2025: <https://d122d2wjqead0l.cloudfront.net/AP/Int/anzsn/uploads/anzsnanzdata_hdcapacitysurvey_specialreport_2025_web.pdf>

Some sources are secondary (trade press, vendor guides). Before a figure goes into a tender, check the primary document named
in the sheet: the FGI edition your authority uses, the HBN, or the chosen vendor's site planning guide.
