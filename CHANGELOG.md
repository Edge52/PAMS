# Changelog

## Release 3.0 — 1 Nov 2026

Waves 3 to 6, on top of release 2.1. Migrations `0007`–`0015`. Update with `git pull` and `npm run demo` (or
`npm run db:migrate` and a restart); your data is kept.

### Wave 6 — reference figures
- Every planning figure (workload rates, benchmark ranges, room sizes, running costs, lead times, special conditions,
  companions) checked against published sources; 11 changed (CT 1 per 12,000 exams a year, X-ray room 1 per 10,000,
  endoscopy 1 per 1,500, ICU ventilators 0.8–1.2 and syringe pumps 3–6 per bed, MRI room 30 m², theatre 37 m², CT/MRI
  service 12 %/10 %, CT/angiography lead time 6/8 months).
- Register with status and sources (`src/lib/boq/reference-figures.ts`), review workbook
  (`npm run reference:sheet` → `docs/reference-figures-review.xlsx`), summary `docs/reference-figures.md`.

### Wave 5 — register data entry and 3D visuals
- Makes and models catalogue with support dates; pick lists on equipment forms; support status on each asset.
- Fleet & standardisation report with preferred models per hospital.
- Global search on every page; free tags on assets.
- Executive summary report (one printable page per hospital).
- `npm run cad:load` loads buildings without demo equipment; going-live checklist with hospital mail settings.
- 3D: architectural (light) style; low walls over the whole building; floor and department labels; basements folded
  away; life-size device models on status rings; selection outline; camera presets (isometric, plan, eye level);
  section cut; glass façade; smooth heat maps.

### Wave 4 — BOQ intelligence and 3D tools
- BOQ Checks tab: risk flags, fit to budget, room requirements against CAD rooms, benchmarks.
- BOQ Phasing & costs tab: opening phases, cash flow by quarter, cost of ownership over 5 and 10 years.
- 3D: lifts and stairs; first floor first loading; lighter graphics on slow devices; plan vs installed with ghosts;
  nearest working device with route.
- Demo: La Plaza equipment fit-out plan (approved, phased).

### Wave 3 — biomedical engineering, 3D package, BOQ quick start
- Work orders (fault reports from QR labels, assignment, response targets, downtime, KPIs); PPM checklists and PPM jobs;
  service contracts and warranty claims; spare parts; recalls (FSCA); disposal with approval; replacement plan to BOQ;
  device performance and cost.
- 3D: problem layers, live status, act from the model, device shapes, room labels, exact placement, saved views and
  images; La Plaza floors 5 m apart, walls 3.3 m.
- BOQ quick start: wizard, hospital templates, workload questions, special conditions, companion items, price tiers and
  scenarios.

## Release 2.1 — 30 Oct 2026
Sign-in and roles, facility limits, approval chains, Law 182 committees and award approval, notifications and email,
five reports, laptop launchers and Docker server. See the release 2.1 system documentation.
