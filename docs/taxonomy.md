# Device taxonomy

`seed-data/device-taxonomy.json` holds the single hierarchical device classification used everywhere: BOQ lines,
technical specs, offers, purchase orders and the asset register. `scripts/seed.ts` loads it into `device_types`.

**Totals:** 788 rows = 22 categories, 107 groups and 659 device types. The last 9 device types and the THR-DVT group were added after the first release, for BOQ standards (see `docs/boq-standards.md`).

## Structure

| Level | Meaning | Example | Used for |
|---|---|---|---|
| 1 | Category | `MON` Patient monitoring & diagnostics | Grouping, filtering, asset tag prefix |
| 2 | Group | `MON-PAT` Patient monitors | Grouping, filtering |
| 3 | Device type | `MON-PAT-HIGH` Patient monitor, high acuity | The purchasable and trackable unit: BOQ line, spec, offer, PO line, asset |

Level 3 is split the way a tender BOQ or a biomedical asset register would split it: by clinical tier, where price and
spec differ materially. Examples are high, mid and transport monitors, 16/32/64/128-slice CT, and volumetric vs syringe vs
PCA pumps. Two things stay out of level 3:
- Options and accessories, such as probes, coils or a second vaporiser, belong in the spec or the offer, not as separate types.
- Consumables are out of scope.

### Code convention
- Uppercase segments joined by `-`: `CAT`, `CAT-GRP`, `CAT-GRP-TYPE`. The number of segments equals the level.
- Category 2–4 letters; group and type segments up to 8 alphanumerics; whole code ≤ 24 characters.
- A child code always starts with its parent code plus `-`.
- Codes are permanent identifiers. Never rename or re-parent a code: other modules and seeds reference them, and
  `seed-data/core-device-codes.json` lists 46 that are guaranteed. Change `name` or `nameAr` freely. To retire a type,
  set `active = false` in the database instead of deleting the row.

### Fields
- `name`: English, sentence case, "Noun, qualifier" style.
- `nameAr`: Modern Standard Arabic as written in Egyptian tenders ("جهاز …").
- `description`: one sentence, on every level-3 row.

Every level-3 row also has:
- `riskClass` (I / IIa / IIb / III)
- `criticality` (LIFE_SUPPORT / HIGH / MEDIUM / LOW)
- `lifeExpectancyYears`, `ppmIntervalMonths`, `requiresCalibration`, `isCapital`
- `priceMinUsd` / `priceMaxUsd`
- `specTemplate`: 4–10 key tender parameters, each `{name, unit?, hint?}`

`gmdnTerm` is a generic preferred-term style name. It is set on 47 well-known types and left out elsewhere.
`umdnsCode` is deliberately left out everywhere: the codes could not be verified against the licensed source.

## Categories

| Code | Category | Groups | Types | Group codes |
|---|---|---:|---:|---|
| `IMG` | Medical imaging | 12 | 70 | CT, MRI, XR, MAM, US, ANG, NM, BMD, DEN, ACC, RPR, PAC |
| `RTH` | Radiotherapy & radiation oncology | 4 | 21 | EBT, BRA, SIM, DOS |
| `MON` | Patient monitoring & diagnostics | 7 | 45 | PAT, ECG, OXI, VIT, NEU, PUL, HEM |
| `CAR` | Cardiology & cardiovascular | 5 | 28 | ECH, STR, CTH, CVS, VAS |
| `LIF` | Life support & critical care | 8 | 56 | VEN, RES, DEF, ANE, AIR, NEO, THM, EMS |
| `INF` | Infusion & drug delivery | 2 | 11 | PMP, ACC |
| `GAS` | Medical gases & vacuum | 4 | 18 | FLW, VAC, SRC, DIS |
| `SUR` | Surgical & operating theatre | 10 | 71 | OR, ENE, LAS, ORT, NEU, MIC, OPH, ROB, SUC, INS |
| `END` | Endoscopy & minimally invasive surgery | 3 | 34 | FLX, RIG, REP |
| `THR` | Renal, urology & specialist therapy | 5 | 18 | HD, CRT, PD, LIT, HBO |
| `OBG` | Obstetrics & gynaecology | 4 | 20 | FET, DEL, GYN, IVF |
| `LAB` | Laboratory | 10 | 75 | HEM, CHE, IMM, BGA, MIC, HIS, MOL, GEN, STO, SAF |
| `BBK` | Blood bank & transfusion | 3 | 13 | STO, PRO, TST |
| `STR` | Sterilization & infection control | 5 | 25 | STE, LTS, WSH, CSS, INF |
| `REH` | Rehabilitation & physiotherapy | 4 | 30 | ELT, THM, EXE, MOB |
| `DEN` | Dental (clinic equipment; dental X-ray is under `IMG-DEN`) | 3 | 17 | UNT, EQP, DIG |
| `OPH` | Ophthalmology & optometry (diagnostics; eye surgery is under `SUR-OPH`) | 3 | 18 | EXM, RET, ANT |
| `ENT` | Ear, nose & throat (incl. audiology) | 2 | 11 | AUD, CLN |
| `DRM` | Dermatology & aesthetic medicine | 2 | 10 | LAS, DX |
| `FUR` | Hospital furniture & patient handling (incl. mortuary) | 5 | 34 | BED, TRN, CRT, EXM, MOR |
| `PHA` | Pharmacy & cold chain | 2 | 12 | AUT, CLD |
| `BME` | Biomedical test equipment | 3 | 13 | TST, FLW, RAD |

The original 10 categories, 26 groups and 46 core types keep their codes, parents and levels. Display names were
improved for `THR` (was "Therapy & treatment") and `FUR`.

Placement conventions where a device could sit in two places:
- Modality goes by technology: all X-ray-producing imaging is under `IMG`, including dental CBCT, angiography and DXA. Cardiac echo is the exception and sits in `CAR-ECH`.
- Surgical use goes by where it is bought: OR-based items are under `SUR`, for example the ophthalmic microscope and phaco.
- Ambulance and pre-hospital items are in `LIF-EMS`.
- Hospital-grade IT is included only where it is medical: PACS, reading workstations and DICOM-calibrated displays (`IMG-PAC`), oncology information systems (`RTH-SIM-OIS`), and the ECG management system.

## How the numeric fields were estimated, and their limits

All numbers are **indicative planning defaults** for a new unit bought in the Egypt/MENA market. They are not quotations
or regulatory determinations. Edit them per project in the app.

- **riskClass**: the typical EU MDR Annex VIII class for the device family. For example, ventilators, defibrillators, infusion pumps, X-ray and dialysis are IIb, and IABP, ECMO and the heart-lung machine are III. Furniture, pharmacy automation and BME test equipment are mostly not medical devices or are class I. `I` there is a placeholder so the field is always filled. The manufacturer's declaration of conformity is authoritative.
- **criticality**: our own four-level scale for maintenance and spares prioritisation.
  - LIFE_SUPPORT: failure can directly cause death (ventilators, anaesthesia, defibrillators, dialysis, ECMO, neonatal thermal support, central gas plant).
  - HIGH: diagnosis or treatment is stopped.
  - MEDIUM and LOW follow from there.
- **lifeExpectancyYears**: anchored on the AHA *Estimated Useful Lives of Depreciable Hospital Assets*, adjusted upward toward
  ECRI/GTZ field practice for well-maintained equipment in the region. AHA uses 5 years for most imaging, which is a US
  accounting life; we use 10 years for CT/MR/X-ray as a replacement-planning life. Flexible endoscopes are 5 years and furniture 12–15 years.
- **ppmIntervalMonths**: typical manufacturer and ECRI-style risk-based intervals.
  - 3 months for CT, MR, angiography and linacs, mirroring service contracts.
  - 6 months for life support, X-ray, sterilizers and lab analysers.
  - 12 months for most other electromedical equipment.
  - 24 months for passive furniture and instrument sets.

  Follow the manufacturer's service manual where it differs.
- **requiresCalibration**: true when the device measures or delivers a quantified output that must be verified, such as dose, flow, pressure, energy or temperature.
- **isCapital**: false for low-cost or semi-consumable items, roughly under USD 1,000–1,500. Adjust to the hospital's capitalisation threshold.
- **priceMinUsd / priceMaxUsd**: a broad range covering entry to premium configurations, excluding VAT/customs, site works and
  multi-year service. Sources:
  - UNICEF Supply Catalogue indicative prices for basic critical-care items
  - published vendor-neutral price guides for imaging and angiography (medindexer, Block Imaging)
  - field knowledge of MENA tender awards

  High-end imaging and radiotherapy prices vary with configuration and FX. Ranges are deliberately wide. Use them for budget sanity checks, not as reference prices.
- **specTemplate**: the parameters a tender spec sheet should state for that type. It is a checklist, not limiting values. `hint` gives typical expectations where useful.

## Sources
- European Commission, *European Medical Device Nomenclature (EMDN)*, used for the hierarchy approach: https://webgate.ec.europa.eu/dyna2/emdn/ ; MedTech Europe EMDN booklet: https://www.medtecheurope.org/wp-content/uploads/2025/05/250522_medtech-europe_emdn-booklet-final2.pdf
- WHO MeDevIS platform (EMDN/GMDN cross-referenced device list): https://medevis.who-healthtechnologies.org/ ; announcement: https://www.who.int/news/item/08-07-2024-medevis-platform-announced-to-boost-access-to-medical-technologies-and-devices
- WHO *List of priority medical devices for cancer management*: https://www.who.int/publications/i/item/9789241565462 ; WHO *List of priority medical devices for management of cardiovascular diseases and diabetes*: https://www.who.int/publications/i/item/9789240027978
- WHO-UNICEF *Technical specifications and guidance for oxygen therapy devices*: https://www.who.int/teams/health-product-policy-and-standards/assistive-and-medical-technology/medical-devices/oxygen
- WHO *Medical equipment maintenance programme overview*: https://www.who.int/publications/i/item/9789241501538
- AHA *Estimated Useful Lives of Depreciable Hospital Assets* (2023 edition announcement): https://www.hfma.org/accounting-and-financial-reporting/ahas-estimated-useful-lives-of-depreciable-hospital-assets-2023-edition-now-available/ ; extract with GTZ ranges: https://pdfcoffee.com/aha-estimated-useful-life-pdf-free.html
- UNICEF Supply Catalogue, resuscitation & anaesthesiology equipment (indicative prices): https://supply.unicef.org/all-materials/medical-devices/resuscitation-anaesthesiology-equipment.html
- Angiography and cath lab price estimates: https://www.medindexer.com/knowledge/angiography-price-estimate , https://medindexer.com/knowledge/catheterization-lab-equipment-price-estimate
- PET/CT price tiers: https://www.blockimaging.com/bid/68875/how-much-does-a-pet-ct-scanner-cost
- Arabic device naming cross-checked against public Arabic procurement and inventory documents, for example Egyptian press reports of ICU equipment deliveries (https://www.dostor.org/5355899) and Saudi MOH equipment lists.

## Adding a new device type
1. Pick the level-2 group. If none fits, add a group row (`level: 2`, `parentCode` = category) first. Add a new category only for a genuinely new clinical domain.
2. Choose a code `GROUP-SUFFIX`, with a suffix of up to 8 uppercase letters or digits and a total of ≤ 24 characters. Check it isn't used. Never reuse a retired code.
3. Fill every level-3 field. Use a sibling row as the template for `riskClass`, `criticality`, life, PPM and `specTemplate`. Keep 4–10 spec items.
4. Keep rows in tree order (category, its groups, each group's types). The seed sorts by level anyway.
5. Run `npm run db:seed` (idempotent upsert on `code`). Existing rows are updated in place, so IDs referenced by BOQs and assets are preserved.
