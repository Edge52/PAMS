# BOQ planning standards: ratios and sources

**Status: draft for review by the commercial engineer.** These are the equipment planning ratios behind the BOQ generator
(`seed-data/boq-standards.json`). Each ratio says what it is based on, how sure we are, and where it comes from, so you can
check it. Start with [Needs your review](#needs-your-review) below.

| Standard set | Purpose | Rules |
|---|---|---|
| `HPAMS-GEN-2026`: General hospital baseline, Egypt 2026 (**default**) | 100-400 bed general/district hospitals and turnkey medical centres (MoHP, UHI and UPA tenders) | 824 |
| `HPAMS-TERT-2026`: Tertiary / university hospital, Egypt 2026 | Derived from the baseline: higher critical-care, imaging and theatre ratios, OPTIONAL items promoted to RECOMMENDED, plus tertiary-only devices | 838 |

Every rule uses a device code that exists in the taxonomy (659 device types). The seed loads all 1,686 rules
with zero "rule skipped" warnings. The 24 lines that were first drafted for devices the taxonomy lacked are now active rules
(see [Devices added to the taxonomy](#devices-added-to-the-taxonomy)).

## How a quantity is calculated

`quantity = rounding(ratio × count)`, then clamped to `[minQty, maxQty]`. Rounding is CEIL (round up) for every rule unless
stated otherwise.

| Basis | Count used | Example |
|---|---|---|
| `PER_BED` | department beds | ICU ventilator 1 per bed × 16 beds = 16 |
| `PER_ROOM` | department rooms | Operating table 1 per room × 6 ORs = 6 |
| `PER_DEPARTMENT` | 1 per department instance | Blood gas analyser 1 per ICU |
| `PER_HOSPITAL_BEDS` | total hospital beds | CT 1 per 250 hospital beds (0.004), minimum 1 |
| `FIXED` | none (the ratio is the quantity) | not used in v1.0 |

### What to enter as "beds" and "rooms" for each department

| Department | Beds = | Rooms = |
|---|---|---|
| ER | treatment spaces, including resuscitation bays and trolleys | not used |
| ICU, CCU, PICU, BURN | bed spaces | not used |
| NICU | cots (incubator and warmer spaces) | not used |
| OR | not used | operating rooms |
| PACU | recovery bays (AAGBI: at least 2 per theatre) | not used |
| DAYSURG | stage 1 and stage 2 recovery places | day-case ORs and procedure rooms |
| WARD-MED, WARD-SURG, WARD-PED, WARD-OBS | inpatient beds (nursing units of about 30 beds are assumed) | not used |
| LDR | LDR rooms or delivery beds | not used |
| ISO | single isolation rooms | not used |
| CATH | holding and recovery bays | cath labs |
| ENDO | recovery bays | procedure rooms |
| DIAL | dialysis stations (chairs and beds) | not used |
| ONC | treatment chairs and beds | not used |
| OPD | not used | consultation and examination rooms |
| REHAB | not used | treatment cubicles |
| DENT | not used | dental surgeries (chairs) |
| OPH | not used | examination lanes |
| ENT | not used | ENT clinic rooms |
| RAD, LAB, BLOOD, PHARM, CSSD, MORT, BIOMED, HOSP | not used (sized on **total hospital beds**, which must be set on the BOQ) | not used |

## Tiers and confidence

**Tier** (what the BOQ includes by default: ESSENTIAL and RECOMMENDED)

- **ESSENTIAL**: needed to open and operate the department safely and to pass licensing (MoHP) or accreditation (GAHAR).
- **RECOMMENDED**: standard good practice for a general hospital. Drop these only for a cost-constrained tender.
- **OPTIONAL**: advanced or tertiary items, or items that depend on the service scope (e.g. ERCP, IABP, autopsy table).

**Confidence**

- **SOURCED**: a published guideline, regulation or official checklist states the ratio (or the item per bed, room or unit), and `sourceRef` cites it. Where our number deviates from the source's, the note says so.
- **INDUSTRY_PRACTICE**: common planning practice in BOQs and tenders. The note gives the reasoning. When a `sourceRef` is present it supports the device's presence or a nearby figure, not the exact ratio.
- **DRAFT**: my best estimate where sources disagree or don't exist. Review these first.

Default set split: **SOURCED 209, INDUSTRY_PRACTICE 594, DRAFT 21**. Tiers: **ESSENTIAL 499, RECOMMENDED 237, OPTIONAL 88**.

## Methodology

1. **Egyptian sources first.** What I found:
   - **Law 51/1981 as amended by Law 153/2004** sets *qualitative* minimums for any facility operating under anaesthesia: an anaesthesia machine with ventilator, ECG/pulse oximetry, BP monitoring, a defibrillator-monitor and suction. Recovery rooms need ECG, a defibrillator, an oximeter and a ventilator. These back the OR, DAYSURG and PACU ESSENTIAL lines (`EG-LAW-51`).
   - **GAHAR Hospital Standards (2021)** are process standards (medical-equipment safety EFS/NSR.27, response to clinical deterioration NSR.09, blood bank storage). They give no device counts. They justify crash carts and defibrillators on every ward and in outpatients, temperature monitoring and the biomedical test equipment (`GAHAR-2021`).
   - **GAHAR National Guide for Medical Equipment for Hospitals (2025)** is the most relevant Egyptian reference. GAHAR announced it with a protocol with the Unified Procurement Authority (UPA) and an app that generates standard equipment lists from a facility's departments, room sizes and beds. **It isn't publicly downloadable**, so none of the ratios here come from it. If you can get the guide or app output for a sample hospital, compare it with the 200-bed check below. Matching rules can then be raised to SOURCED with `sourceRef: GAHAR-NMEG` (the source entry already exists).
   - I found no MoHP minimum-equipment schedule with per-bed numbers, and no public UPA/UHI tender BOQs, online.
2. **Regional regulators and official checklists with explicit quantities.** These are the main SOURCED basis: the Saudi MOH commissioning and NICU evaluation checklists, DHA (Dubai) facility guidelines and inspection checklists, and Florida's NICU rule. The Indian NHSRC *Critical Care Hospital Block* annexure lists equipment per 50/100-bed block, department by department, and is the single most useful quantified list. Also used: IPHS 2022/2012, the ISCCM 2010 ICU guideline and the IAP 2020 PICU consensus.
3. **Professional guidance** for presence and minimums: DIVI 2023 (ICU levels), ESICM 2011, AAGBI 2013 (PACU), WHO Safe Surgery 2009 (anaesthesia monitoring), NICE CG65 (perioperative warming), the PhilHealth/CDC/UK Kidney Association/DHA dialysis guidance, WHO decontamination guidance (CSSD/endoscopy) and the DHA mortuary guideline (1 body space per 25 beds).
4. **WHO priority device lists** (RMNCH, cancer, cardiovascular/diabetes) and WHO-UNICEF oxygen specifications are cited as background for *including* a device category. They don't give per-bed quantities, and I couldn't retrieve their full texts during drafting, so no rule is marked SOURCED on them alone.
5. **Industry practice and draft estimates** fill the rest. Each has a one-sentence rationale in `notes`.
6. **Redundancy convention.** Backups are built into the ratio, not added as separate lines (e.g. dialysis 1.1 machines per station, and a minimum of 2 for sterilizers and washer-disinfectors). The `HOSP` department carries equipment-library swap stock for pumps.

## Needs your review

These are the ratios with the largest cost impact or the least certainty. The 200-bed effect uses the reference hospital below.

| # | Rule (department → device) | Current ratio | What sources say | 200-bed effect | Why review |
|---|---|---|---|---|---|
| 1 | ICU → ICU ventilator | 1 per bed, ESSENTIAL | NHSRC 20 for 20 ICU beds (1:1), but 10 for a 16-bed hybrid ICU/HDU; DIVI: every ICU bed ventilation-capable | 16 | Largest single cost line. Use about 0.6 if half the "ICU" beds are really HDU. |
| 2 | ICU → syringe 3/bed + volumetric 2/bed | 5 channels per bed | Saudi 4-8 per bed (incl. 25% reserve); NHSRC 1 syringe + 0.25 volumetric | 48 + 32 | High volume, price-sensitive. 4 per bed is defensible for general ICUs. |
| 3 | CCU → ICU ventilator | 1 per 3 beds (DRAFT) | No direct source | 3 | Many Egyptian CCUs share ventilators with ICU. |
| 4 | NICU → neonatal ventilator | 0.5 per cot, minimum 2 (DRAFT) | Florida Level II 1 per 3; Saudi 1 per bed + 20% | 5 | Depends on NICU level. Tertiary set uses 1.0. |
| 5 | ER → ICU ventilator | 0.15 per space (DRAFT) | NHSRC 4 per 10 ED beds (critical-care block) | 3 | NHSRC's ED is ICU-like, and ours relies on ICU on site. |
| 6 | Wards → volumetric pump | 0.25 per bed (med), 0.2 (surg), 0.2 (ped), 0.15 (obs), all DRAFT | NHSRC lists none on general wards | 25 | Big total across many beds. Egyptian practice varies a lot (gravity sets are common). |
| 7 | Wards → vital-signs monitor 1 per 8 beds + mid-acuity monitor 0.1 per bed (R) | as stated | No numeric source | 16 VS + 10 monitors | Early-warning (NEWS) practice. Drop the mid-acuity line for budget tenders. |
| 8 | Wards → electric 3-motor beds | 1 per bed | Manual beds (`FUR-BED-WARD`) are the budget alternative | 100 | Changes the bed cost severalfold. Switch the device on the BOQ line if the client wants manual beds. |
| 9 | RAD → 64-slice CT | 1 per 250 hospital beds, minimum 1 | No ratio source; DIVI ties ICUs to 24-hour CT | 1 | At 251+ beds this gives 2 CTs. Confirm the step point (250 or 300). |
| 10 | RAD → 1.5 T MRI | 1 per department, RECOMMENDED | None | 1 | Set to OPTIONAL for hospitals under about 150 beds. |
| 11 | RAD → fixed DR 1 per 100 beds; mobile DR 1 per 200 beds + 1 each in ICU and ER (R) | as stated | Saudi/NHSRC: 1 portable X-ray per ICU and per ED | 2 fixed, 3 mobile | Mobile DR is often shared across floors. |
| 12 | RAD → general ultrasound 1 per ~67 beds (minimum 2); OPD 1 per 10 rooms | as stated | None | 3 + 2 | Depends on the obstetric and outpatient load. |
| 13 | OR → defibrillator 1 per 2 ORs; C-arm 1 per 3 ORs; lap tower 1 per 2 ORs; 2 pendants per OR | as stated | NHSRC: 1 defibrillator per OT; Law 153/2004 requires a defibrillator | 3 / 2 / 3 / 12 | Theatre fit-out is the biggest capital block after imaging. |
| 14 | OR → major instrument sets 3 per OR; minor 2 per OR | as stated | WHO decontamination turnaround logic | 18 + 12 | Depends on the specialty mix and CSSD shifts. |
| 15 | Blood gas analysers in ICU, CCU (R), NICU, OR, ER (R) and LAB (R) | 1 per department | ISCCM/NHSRC/IAP: 1 per ICU; Saudi/DHA: in the NICU | 6 | Cartridge costs follow. Consolidate if the units share a floor. |
| 16 | LDR → CTG | 1 per labour bed, ESSENTIAL | DHA: CTG per labour room; WHO accepts intermittent auscultation for low-risk labour | 1 per LDR | Use 0.5 for low-risk units. |
| 17 | DIAL → haemodialysis machine | 1.1 per station | PhilHealth: 1 backup per 15; CDC: dedicated machines for HBsAg+ | 11 for 10 stations | Egyptian HCV/HBV segregation may justify more spares. |
| 18 | CSSD → large steam sterilizer and washer-disinfector | 1 per 100 beds, minimum 2 (DRAFT) | Getinge: no international standard; size by procedure volume | 2 + 2 | Must be checked against chamber size and OR case-load. |
| 19 | MORT → mortuary refrigerator | 1 **body space** per 25 beds, minimum 2 | DHA mortuary guideline (SOURCED) | 8 spaces | The quantity is body spaces, so convert to cabinet modules (2/3/4/6-body) when pricing. |
| 20 | LAB → chemistry, immunoassay and 5-part haematology analysers | 1 per 200 beds each, minimum 1 | None | 1 each | Throughput matters more than count. Check against expected tests per hour. |
| 21 | ONC → volumetric pump | 1.5 per chair | None numeric | n/a | Multi-line regimens. 1 per chair is the budget option. |
| 22 | PICU → ICU ventilator | 0.6 per bed, minimum 2 | IAP: 4-6 ventilator beds in a 6-12 bed Level 3 PICU | n/a | Tertiary set uses 1.0. |
| 23 | ENDO → gastroscopes 3 per room, colonoscopes 2 per room | as stated | Reprocessing turnaround (AER cycle about 30-45 min) | n/a | Scope count drives cost more than towers do. |

## Per-department summary (default set)

Key capital lines only. The full list is in the JSON or the app at `/boq/standards`. "(R)" means RECOMMENDED; "min" is minQty.

| Department | Rules | Key ratios (ESSENTIAL unless marked) |
|---|---|---|
| ER (Emergency department) | 53 | Stretcher, emergency with X-ray 1/bed; Patient monitor, high acuity 1 per 5 beds (min 1); Patient monitor, mid acuity 0.8/bed; Ventilator, ICU 0.15/bed (min 1); Ventilator, transport 1 per 20 beds (min 1); Ventilator, non-invasive 1 per 20 beds (min 1) (R); Infusion pump, volumetric 1 per 2 beds |
| ICU (Adult intensive care) | 41 | Bed, ICU electric 1/bed; Patient monitor, high acuity 1/bed; Ventilator, ICU 1/bed; Ventilator, non-invasive 1 per 4 beds (R); Ventilator, transport 1 per 8 beds (min 1); Syringe pump 3/bed; Infusion pump, volumetric 2/bed |
| CCU (Coronary care unit) | 31 | Bed, ICU electric 1/bed; Patient monitor, high acuity 1/bed; Ventilator, ICU 1 per 3 beds (min 1); Ventilator, non-invasive 1 per 4 beds (min 1); Syringe pump 2/bed; Infusion pump, volumetric 1/bed; Defibrillator-monitor, manual 1 per 4 beds (min 2) |
| NICU (Neonatal intensive care) | 36 | Infant incubator 0.8/bed; Infant radiant warmer 0.3/bed; Patient monitor, mid acuity 1/bed; Ventilator, neonatal 1 per 2 beds (min 2); Bubble CPAP system, neonatal 1 per 3 beds (min 1); Syringe pump 2/bed; Infusion pump, volumetric 1 per 2 beds (R) |
| PICU (Paediatric intensive care) | 36 | Bed, ICU electric 0.6/bed; Cot, paediatric 0.4/bed; Infant radiant warmer 1 per 4 beds (min 1) (R); Patient monitor, high acuity 1/bed; Ventilator, ICU 0.6/bed (min 2); Ventilator, non-invasive 1 per 4 beds (min 1); Ventilator, transport 1/dept |
| OR (Operating theatres) | 51 | Operating table 1/room; Surgical light, ceiling 1/room; Anaesthesia workstation 1/room; Patient monitor, high acuity 1/room; Syringe pump 2/room; Infusion pump, volumetric 1/room; Defibrillator-monitor, manual 1 per 2 rooms (min 1) |
| PACU (Recovery (PACU)) | 20 | Patient monitor, mid acuity 1/bed; Syringe pump 1/bed; Infusion pump, volumetric 1 per 2 beds; Defibrillator-monitor, manual 1/dept; Ventilator, ICU 1/dept (R) |
| DAYSURG (Day surgery) | 27 | Operating table 1/room; Surgical light, ceiling 1/room; Anaesthesia workstation 1/room; Patient monitor, high acuity 1/room; Syringe pump 2/room; Defibrillator-monitor, manual 1/dept; Patient monitor, mid acuity 0.4/bed |
| WARD-MED (Medical inpatient ward) | 30 | Bed, ward electric 3-motor 1/bed; Defibrillator-monitor, manual 1 per 30 beds (min 1); Pharmacy refrigerator, medical-grade 1 per 30 beds (min 1); Patient monitor, mid acuity 1 per 10 beds (min 1) (R); Infusion pump, volumetric 1 per 4 beds; Syringe pump 1 per 10 beds (min 1); Ventilator, non-invasive 1 per 30 beds (min 1) (R) |
| WARD-SURG (Surgical inpatient ward) | 29 | Bed, ward electric 3-motor 1/bed; Defibrillator-monitor, manual 1 per 30 beds (min 1); Pharmacy refrigerator, medical-grade 1 per 30 beds (min 1); Patient monitor, mid acuity 1 per 10 beds (min 1) (R); Infusion pump, volumetric 1 per 5 beds; Syringe pump 1 per 10 beds (min 1) |
| WARD-PED (Paediatric ward) | 29 | Cot, paediatric 0.6/bed; Defibrillator-monitor, manual 1 per 30 beds (min 1); Pharmacy refrigerator, medical-grade 1 per 30 beds (min 1); Patient monitor, mid acuity 1 per 10 beds (min 1) (R); Infusion pump, volumetric 1 per 5 beds; Syringe pump 0.3/bed |
| WARD-OBS (Obstetrics & gynaecology ward) | 29 | Bed, ward electric 3-motor 1/bed; Defibrillator-monitor, manual 1 per 30 beds (min 1); Pharmacy refrigerator, medical-grade 1 per 30 beds (min 1); Cardiotocograph (fetal monitor) 1 per 10 beds (min 1); Infusion pump, volumetric 0.15/bed (min 1); Syringe pump 1 per 10 beds (min 1) |
| LDR (Labour & delivery) | 29 | Delivery bed, electric 1/bed; Cardiotocograph (fetal monitor) 1/bed; Infant radiant warmer 1/bed; Patient monitor, mid acuity 1 per 2 beds (min 1); Infusion pump, volumetric 1/bed; Syringe pump 1 per 2 beds (min 1) (R); Ultrasound system, point-of-care 1/dept |
| ISO (Isolation unit) | 28 | Bed, ward electric 3-motor 1/bed; Patient monitor, mid acuity 1 per 2 beds (R); Infusion pump, volumetric 0.4/bed; Syringe pump 0.4/bed; Ventilator, non-invasive 0.17/bed (min 1) (R); Defibrillator-monitor, manual 1/dept |
| BURN (Burns unit) | 31 | Bed, ICU electric 0.75/bed; Patient monitor, high acuity 1 per 2 beds (min 1); Patient monitor, mid acuity 1 per 2 beds; Ventilator, ICU 0.3/bed (min 1); Infusion pump, volumetric 1.5/bed; Syringe pump 1/bed; Defibrillator-monitor, manual 1/dept |
| RAD (Radiology & imaging) | 27 | Digital radiography system, fixed 1 per 100 hosp. beds (min 1); Digital radiography system, mobile 1 per 200 hosp. beds (min 1); Fluoroscopy system, remote-controlled 1/dept (R); CT scanner, 64-slice 1 per 250 hosp. beds (min 1); Contrast injector, CT 1 per 250 hosp. beds (min 1); MRI scanner, 1.5 T 1/dept (R); Contrast injector, MR 1/dept (R) |
| CATH (Cardiac catheterisation lab) | 25 | Angiography system, single-plane 1/room; Haemodynamic recording system 1/room; Contrast injector, angiography 1/room; Ceiling-suspended radiation shield 1/room; Lead apron 6/room; Defibrillator-monitor, manual 1/room; External temporary pacemaker 1/room |
| ENDO (Endoscopy) | 23 | Endoscopy tower, gastrointestinal 1/room; Gastroscope, video 3/room; Patient monitor, mid acuity 1/room; Syringe pump 1/room (R); Defibrillator-monitor, manual 1/dept |
| LAB (Clinical laboratory) | 40 | Clinical chemistry analyser, automated 1 per 200 hosp. beds (min 1); Immunoassay analyser, chemiluminescence 1 per 200 hosp. beds (min 1); Haematology analyser, 5-part 1 per 200 hosp. beds (min 1) |
| BLOOD (Blood bank) | 19 | Blood bank refrigerator 1 per 100 hosp. beds (min 2); Gel card centrifuge and incubator set 1/dept |
| DIAL (Haemodialysis) | 19 | Haemodialysis machine 1.1/bed; Dialysis chair, powered 0.8/bed; Bed, ward electric 3-motor 1 per 5 beds (min 1); Water treatment plant, dialysis RO 1/dept; Patient monitor, mid acuity 1 per 10 beds (min 1) (R); Defibrillator-monitor, manual 1/dept; Infusion pump, volumetric 1 per 10 beds (min 1) (R) |
| ONC (Oncology day care) | 17 | Recliner, patient/visitor 0.8/bed; Bed, ward electric 3-motor 1 per 5 beds (min 1); Infusion pump, volumetric 1.5/bed; Syringe pump 1 per 5 beds (min 1) (R); Cytotoxic safety cabinet / isolator 1/dept; Automated external defibrillator 1/dept; Pharmacy refrigerator, medical-grade 1/dept |
| OPD (Outpatient clinics) | 33 | Examination couch 1/room; Ultrasound system, general imaging 1 per 10 rooms (min 1) (R); Cardiotocograph (fetal monitor) 1/dept (R); Automated external defibrillator 1 per 20 rooms (min 1); Surgical light, mobile 1/dept (R) |
| REHAB (Physiotherapy & rehabilitation) | 20 | Physiotherapy treatment table, electric 1/room; Combination therapy unit, electro/ultrasound 1 per 2 rooms (min 1); Automated external defibrillator 1/dept |
| DENT (Dental clinic) | 19 | Dental unit with chair 1/room; Dental X-ray unit, intraoral 1 per 2 rooms (min 1); Intraoral X-ray sensor 1 per 2 rooms (min 1) (R); Panoramic dental X-ray 1/dept (R); Lead apron 1 per 2 rooms (min 1); Automated external defibrillator 1/dept |
| OPH (Ophthalmology) | 20 | Slit lamp biomicroscope 1/room; Refraction unit with phoropter and chart 1/room; Automated external defibrillator 1/dept (R) |
| ENT (Ear, nose & throat) | 14 | ENT treatment unit 1/room; Audiometer, diagnostic 1/dept; Automated external defibrillator 1/dept (R) |
| PHARM (Pharmacy) | 8 | Pharmacy refrigerator, medical-grade 1 per 100 hosp. beds (min 2) |
| CSSD (Central sterile services) | 11 | Steam sterilizer, large 1 per 100 hosp. beds (min 2); Washer-disinfector 1 per 100 hosp. beds (min 2) |
| MORT (Mortuary) | 6 | Mortuary refrigerator 1 per 25 hosp. beds (min 2) |
| BIOMED (Biomedical engineering workshop) | 12 | Electrical safety analyser 1 per 400 hosp. beds (min 1) |
| HOSP (Hospital-wide (shared)) | 11 | Automated external defibrillator 1 per 100 hosp. beds (min 2); Infusion pump, volumetric 1 per 50 hosp. beds (min 2) (R); Syringe pump 1 per 50 hosp. beds (min 2) (R) |

## 200-bed sanity check

The reference hospital uses the default set, ESSENTIAL and RECOMMENDED tiers, and 200 total hospital beds:
ER 20 spaces, ICU 16, CCU 8, NICU 10, OR 6 rooms, PACU 8 bays, WARD-MED 40, WARD-SURG 40, WARD-PED 20, WARD-OBS 20,
RAD, LAB, OPD 20 rooms, CSSD and DIAL 10 stations. I calculated it with the engine's own rules: CEIL after removing
float noise, then the min/max clamps, using ratios as stored in float4.

**Result: 433 BOQ lines, 177 distinct device types, 2,022 units.** Top 30 lines by quantity:

| # | Device | Code | Total qty | Split by department |
|---|---|---|---|---|
| 1 | Oxygen flowmeter, wall | `GAS-FLW-O2F` | 178 | ER 20, ICU 16, CCU 8, PACU 8, WARD-MED 40, WARD-SURG 40, WARD-PED 20, WARD-OBS 20, RAD 3, DIAL 3 |
| 2 | Vacuum regulator, wall | `GAS-VAC-REG` | 156 | ER 20, ICU 32, CCU 8, NICU 10, OR 18, PACU 8, WARD-MED 20, WARD-SURG 20, WARD-PED 10, WARD-OBS 10 |
| 3 | Bedside cabinet | `FUR-EXM-BSC` | 144 | ICU 16, CCU 8, WARD-MED 40, WARD-SURG 40, WARD-PED 20, WARD-OBS 20 |
| 4 | Syringe pump | `INF-PMP-SYR` | 130 | ER 10, ICU 48, CCU 16, NICU 20, OR 12, PACU 8, WARD-MED 4, WARD-SURG 4, WARD-PED 6, WARD-OBS 2 |
| 5 | Overbed table | `FUR-EXM-OBT` | 104 | ICU 16, CCU 8, WARD-MED 40, WARD-SURG 40 |
| 6 | Bed, ward electric 3-motor | `FUR-BED-WARDE` | 102 | WARD-MED 40, WARD-SURG 40, WARD-OBS 20, DIAL 2 |
| 7 | Infusion pump, volumetric | `INF-PMP-VOL` | 91 | ER 10, ICU 32, CCU 8, NICU 5, OR 6, PACU 4, WARD-MED 10, WARD-SURG 8, WARD-PED 4, WARD-OBS 3, DIAL 1 |
| 8 | IV pole, mobile | `INF-ACC-POLE` | 87 | ER 10, ICU 8, CCU 4, NICU 5, WARD-MED 20, WARD-SURG 20, WARD-PED 10, WARD-OBS 10 |
| 9 | Patient monitor, mid acuity | `MON-PAT-MID` | 45 | ER 16, NICU 10, PACU 8, WARD-MED 4, WARD-SURG 4, WARD-PED 2, DIAL 1 |
| 10 | Patient monitor, high acuity | `MON-PAT-HIGH` | 34 | ER 4, ICU 16, CCU 8, OR 6 |
| 11 | Glucometer, hospital-grade | `LAB-BGA-GLU` | 27 | ER 2, ICU 4, CCU 2, NICU 2, OR 1, PACU 1, WARD-MED 4, WARD-SURG 4, WARD-PED 2, WARD-OBS 2, DIAL 1, OPD 2 |
| 12 | Wheelchair, standard | `REH-MOB-WCS` | 27 | ER 4, ICU 1, CCU 1, WARD-MED 4, WARD-SURG 4, WARD-PED 2, WARD-OBS 2, RAD 2, DIAL 2, OPD 5 |
| 13 | Stretcher trolley | `FUR-TRN-STR` | 26 | ER 2, ICU 1, CCU 1, OR 6, PACU 8, WARD-MED 2, WARD-SURG 2, WARD-PED 1, WARD-OBS 1, DIAL 1, OPD 1 |
| 14 | Diagnostic set, wall-mounted | `MON-VIT-DIAG` | 26 | WARD-MED 2, WARD-SURG 2, WARD-PED 1, WARD-OBS 1, OPD 20 |
| 15 | Suction unit, mobile | `SUR-SUC-MOB` | 25 | ER 4, ICU 4, CCU 2, PACU 2, WARD-MED 3, WARD-SURG 3, WARD-PED 2, WARD-OBS 2, RAD 1, DIAL 1, OPD 1 |
| 16 | Bed, ICU electric | `FUR-BED-ICU` | 24 | ICU 16, CCU 8 |
| 17 | Ventilator, ICU | `LIF-VEN-ICU` | 23 | ER 3, ICU 16, CCU 3, PACU 1 |
| 18 | Vital signs monitor | `MON-PAT-VS` | 23 | ER 2, WARD-MED 5, WARD-SURG 5, WARD-PED 3, WARD-OBS 3, RAD 1, OPD 4 |
| 19 | Stretcher, emergency with X-ray | `FUR-TRN-STRE` | 22 | ER 20, RAD 2 |
| 20 | Examination couch | `FUR-EXM-COUCH` | 20 | OPD 20 |
| 21 | Sphygmomanometer, wall aneroid | `MON-VIT-BPW` | 20 | OPD 20 |
| 22 | Defibrillator-monitor, manual | `LIF-DEF-MAN` | 19 | ER 2, ICU 2, CCU 2, NICU 1, OR 3, PACU 1, WARD-MED 2, WARD-SURG 2, WARD-PED 1, WARD-OBS 1, RAD 1, DIAL 1 |
| 23 | Instrument set, general surgery major | `SUR-INS-GEN` | 18 | OR 18 |
| 24 | Instrument set, minor surgery | `SUR-INS-MIN` | 18 | ER 4, OR 12, OPD 2 |
| 25 | Bassinet, newborn | `FUR-BED-BAS` | 16 | WARD-OBS 16 |
| 26 | Crash cart | `FUR-CRT-CRASH` | 16 | ER 2, ICU 2, CCU 1, NICU 1, OR 1, PACU 1, WARD-MED 2, WARD-SURG 2, WARD-OBS 1, RAD 1, DIAL 1, OPD 1 |
| 27 | Dressing trolley | `FUR-CRT-DRS` | 16 | ER 2, ICU 2, WARD-MED 3, WARD-SURG 3, WARD-PED 2, WARD-OBS 2, OPD 2 |
| 28 | Pulse oximeter, handheld | `MON-OXI-HH` | 16 | ER 2, NICU 2, WARD-MED 4, WARD-SURG 4, WARD-PED 2, WARD-OBS 2 |
| 29 | Resuscitator bag set | `LIF-RES-RSB` | 15 | ER 5, NICU 10 |
| 30 | Forced-air warming unit | `LIF-THM-FAW` | 15 | ER 2, ICU 3, OR 6, PACU 4 |

Key lines (all departments in the reference hospital):

| Device | Code | Total qty | Split |
|---|---|---|---|
| Ventilator, ICU | `LIF-VEN-ICU` | 23 | ER 3, ICU 16, CCU 3, PACU 1 |
| Ventilator, transport | `LIF-VEN-TRN` | 4 | ER 1, ICU 2, OR 1 |
| Ventilator, neonatal | `LIF-VEN-NEO` | 5 | NICU 5 |
| Ventilator, non-invasive | `LIF-VEN-NIV` | 9 | ER 1, ICU 4, CCU 2, WARD-MED 2 |
| Patient monitor, high acuity | `MON-PAT-HIGH` | 34 | ER 4, ICU 16, CCU 8, OR 6 |
| Patient monitor, mid acuity | `MON-PAT-MID` | 45 | ER 16, NICU 10, PACU 8, WARD-MED 4, WARD-SURG 4, WARD-PED 2, DIAL 1 |
| CT scanner, 64-slice | `IMG-CT-64` | 1 | RAD 1 |
| MRI scanner, 1.5 T | `IMG-MRI-15T` | 1 | RAD 1 |
| Digital radiography system, fixed | `IMG-XR-DR` | 2 | RAD 2 |
| Digital radiography system, mobile | `IMG-XR-MDR` | 3 | ER 1, ICU 1, RAD 1 |
| Ultrasound system, general imaging | `IMG-US-GEN` | 5 | RAD 3, OPD 2 |
| Ultrasound system, point-of-care | `IMG-US-POC` | 5 | ER 1, ICU 1, NICU 1, OR 2 |
| Anaesthesia workstation | `LIF-ANE-WS` | 6 | OR 6 |
| Defibrillator-monitor, manual | `LIF-DEF-MAN` | 19 | ER 2, ICU 2, CCU 2, NICU 1, OR 3, PACU 1, WARD-MED 2, WARD-SURG 2, WARD-PED 1, WARD-OBS 1, RAD 1, DIAL 1 |
| Crash cart | `FUR-CRT-CRASH` | 16 | ER 2, ICU 2, CCU 1, NICU 1, OR 1, PACU 1, WARD-MED 2, WARD-SURG 2, WARD-OBS 1, RAD 1, DIAL 1, OPD 1 |
| Haemodialysis machine | `THR-HD-MCH` | 11 | DIAL 11 |
| Steam sterilizer, large | `STR-STE-LG` | 2 | CSSD 2 |
| Washer-disinfector | `STR-WSH-WD` | 2 | CSSD 2 |
| Clinical chemistry analyser, automated | `LAB-CHE-AUTO` | 1 | LAB 1 |
| Blood gas analyser | `LAB-BGA-ANL` | 6 | ER 1, ICU 1, CCU 1, NICU 1, OR 1, LAB 1 |
| C-arm, mobile surgical | `IMG-XR-CARM` | 2 | OR 2 |
| Laparoscopy tower, HD | `END-RIG-LAP` | 3 | OR 3 |

## Tertiary set (`HPAMS-TERT-2026`)

This is a copy of the default set with the changes below. Every changed line is noted as a tertiary uplift, and none stays SOURCED.

- **OPTIONAL → RECOMMENDED** for every OPTIONAL rule (ECMO-capable ICU, IABP, ERCP/EUS, histology frozen sections, PCR, etc.).
- **Ratio uplifts:** ICU Ventilator, ICU 1→1.1; ICU Patient monitor, high acuity 1→1.1; ICU Syringe pump 3→4; ICU Ventilator, non-invasive 0.25→0.333; ICU CRRT machine 0.125→0.2; ICU Bronchoscope, video 1→2; ICU Cardiac output monitor, minimally invasive 0.125→0.25; ICU Ultrasound system, point-of-care 1→2; CCU Ventilator, ICU 0.333→0.5; CCU Syringe pump 2→3; PICU Ventilator, ICU 0.6→1; PICU Syringe pump 3→4; NICU Ventilator, neonatal 0.5→1; NICU Syringe pump 2→3; NICU Infusion pump, volumetric 0.5→1; NICU Patient monitor, mid acuity 1→1.1; ER Ventilator, ICU 0.15→0.25; ER Patient monitor, high acuity 0.2→0.3; OR Defibrillator-monitor, manual 0.5→1; OR C-arm, mobile surgical 0.333→0.5; OR Laparoscopy tower, HD 0.5→0.75; OR Vessel sealing generator 0.333→0.5; OR Video laryngoscope 0.333→0.5; OR Ultrasound system, point-of-care 0.25→0.333; WARD-MED Infusion pump, volumetric 0.25→0.33; WARD-SURG Infusion pump, volumetric 0.2→0.3; WARD-MED Patient monitor, mid acuity 0.1→0.15; RAD CT scanner, 64-slice 0.004→0.005; RAD Digital radiography system, fixed 0.01→0.013; RAD Ultrasound system, general imaging 0.015→0.02; LAB Clinical chemistry analyser, automated 0.005→0.007; LAB Immunoassay analyser, chemiluminescence 0.005→0.007; ENDO Gastroscope, video 3→4; ENDO Colonoscope, video 2→3; CSSD Steam sterilizer, large 0.01→0.013; CSSD Washer-disinfector 0.01→0.013.
- **Additional devices:** ICU: ECMO system; ICU: Viscoelastic haemostasis analyser; OR: Cell saver (autotransfusion system); OR: Intraoperative neuromonitoring system; OR: Operating microscope, neurosurgical; OR: Surgical navigation system; OR: Laparoscopy tower, 4K/3D with ICG; OR: Viscoelastic haemostasis analyser; RAD: CT scanner, 128-slice or higher; RAD: MRI scanner, 3.0 T; RAD: Advanced visualisation workstation; LAB: MALDI-TOF identification system; LAB: Flow cytometer, clinical; CATH: Angiography system, biplane.

## Devices added to the taxonomy

These nine devices were missing from the first taxonomy. They have since been added to `seed-data/device-taxonomy.json`,
and their 24 draft lines were moved from `pendingRules` into `rules`. `pendingRules` is now empty; use it again the same way
if a future rule needs a device the taxonomy doesn't have yet.

| Code | Device | Group | Used in (default set) |
|---|---|---|---|
| `THR-DVT-IPC` | Intermittent pneumatic compression (DVT) pump | THR-DVT, a new group | ICU (bed 0.25, recommended); WARD-MED (bed 0.033, optional); WARD-SURG (bed 0.067, recommended) |
| `OBG-DEL-BPMP` | Breast pump, hospital-grade | OBG-DEL | NICU (bed 0.167, recommended); WARD-OBS (bed 0.067, recommended) |
| `SUR-OR-MAYO` | Mayo instrument stand | SUR-OR | OR (room 1, essential) |
| `FUR-TRN-SHW` | Shower trolley, burns | FUR-TRN | BURN (department 1, essential) |
| `SUR-INS-MESH` | Skin graft mesher | SUR-INS (first proposed as `SUR-PLA-MESH`) | BURN (department 1, essential) |
| `REH-EXE-STAIR` | Training staircase | REH-EXE | REHAB (department 1, recommended) |
| `REH-EXE-MAT` | Treatment mat platform (Bobath table) | REH-EXE | REHAB (department 1, recommended) |
| `STR-WSH-WTR` | Water treatment plant, CSSD (RO / demineralised) | STR-WSH | CSSD (department 1, essential) |
| `STR-WSH-DRY` | Instrument drying cabinet | STR-WSH | CSSD (department 1, recommended) |

**Nearest-code substitutions.** The device exists, but under a slightly different name or scope. Check the spec on the BOQ line.

| Need | Code used | Note |
|---|---|---|
| Normal-delivery / episiotomy instrument set | `SUR-INS-MIN` | Instrument set, minor surgery (LDR, 2 per delivery bed) |
| Endoscopic CO2 insufflator | `END-RIG-INS` | Laparoscopic insufflator; endoscopy units need the low-flow CO2 type |
| Laboratory -20 °C freezer | `PHA-CLD-FRZ` | Pharmacy freezer, -20 °C (medical-grade) |
| Burns dermatome | `SUR-ORT-TQK` | Dermatome, electric/pneumatic (listed under orthopaedic & power tools) |
| Mortuary body storage | `FUR-MOR-REF` | Counted in body spaces, not cabinets |
| Dialysis-unit scale | `MON-VIT-BED` | Bed and chair scale (wheelchair weighing) |

## Notes for maintainers

- `ratio` is stored as `real` (float4). Repeating fractions such as 1/30 come back as 0.033333335. The engine's `clean()` removes noise to 1e-6, which is safe for department sizes up to about 150 beds. At about 300 beds, 0.033333335 × 300 = 10.0000005 rounds up to 11. If very large single departments are expected, the engine should compare with a relative tolerance (or the column should become `numeric`). Ratios in this file are written to 8 decimals for that reason; don't round them to 3-4 decimals (0.0667 × 15 = 1.0005 → 2).
- One rule per (set, department, device) is enforced by a unique index. Where a department needs a device in two configurations (e.g. ICU beds plus paediatric cots), each configuration uses its own device code.
- PER_HOSPITAL_BEDS rules need the BOQ's total hospital beds. If it's 0, the engine sums department beds.

## Sources

- **`NHSRC-CCB`**: Guidelines on Critical Care Hospital Block (PM-ABHIM), Annexure 2 equipment lists for 50/100-bed blocks. NHSRC / Ministry of Health & Family Welfare, India, 2022. <https://nhsrcindia.org/sites/default/files/Guidelines%20on%20Critical%20Care%20Hospital%20Block-PM-ABHIM_2022%20-%2003-11-2022.pdf> (206 rules)
- **`IPHS-2022`**: Indian Public Health Standards 2022, Volume I: Sub-District and District Hospitals. NHSRC / MoHFW India, 2022. <https://nhsrcindia.org/sites/default/files/Volume%201_SDH-DH.pdf> (0 rules)
- **`MOHFW-DH`**: IPHS Guidelines for District Hospitals (101-500 bedded), revised. DGHS, MoHFW India, 2012. <https://clinicalestablishments.mohfw.gov.in/sites/default/files/2021-12/108.pdf> (18 rules)
- **`NHSRC-HDCL`**: Self-assessment checklist for haemodialysis services (PM National Dialysis Programme). NHSRC India. <https://www.nhsrcindia.org/sites/default/files/SELF%20ASSESSMENT%20CHECKLIST%20FOR%20HAEMODIALYSIS%20SERVICES-PMNDP.pdf> (2 rules)
- **`ISCCM-2010`**: ICU Planning and Designing in India: Guidelines 2010 (12-bed ICU / 8-bed HDU equipment list). Indian Society of Critical Care Medicine, 2010. <https://pdfcoffee.com/icu-designing-and-planning-pdf-free.html> (10 rules)
- **`IAP-PICU-2020`**: Consensus Guidelines for Pediatric Intensive Care Units in India (Khilnani et al., Indian Pediatrics 57:1049-54). IAP Intensive Care Chapter, 2020. <https://www.indianpediatrics.net/nov2020/nov-1049-1054.htm> (34 rules)
- **`DIVI-2023`**: Recommendations on the structure, personnel and organization of intensive care units (Front. Med. 10:1196060). DIVI (German Interdisciplinary Association for Intensive Care), 2023. <https://dx.doi.org/10.3389/fmed.2023.1196060> (9 rules)
- **`ESICM-2011`**: Recommendations on basic requirements for intensive care units: structural and organizational aspects (Intensive Care Med). ESICM, 2011. <https://pubmed.ncbi.nlm.nih.gov/21918847/> (0 rules)
- **`SA-MOH-COMM`**: Hospital commissioning checklists. Ministry of Health, Saudi Arabia. <https://www.moh.gov.sa/Documents/HOSPITAL-COMMISSIONING-CHECKLISTS.pdf> (50 rules)
- **`SA-MOH-NICU`**: Hospital evaluation list: neonatal intensive care. Ministry of Health, Saudi Arabia. <https://www.moh.gov.sa/Documents/Hospital-evaluation-list-neonatal-intensive-care.pdf> (28 rules)
- **`FL-NICU`**: Florida Administrative Code R. 59A-3.249: Neonatal Intensive Care Units. Florida Agency for Health Care Administration. <https://law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-59A-3-249> (18 rules)
- **`DHA-ICU`**: DHA Health Facility Guidelines, Part B: Intensive Care Unit. Dubai Health Authority. <https://services.dha.gov.ae/tahpi-app/HealthFacilityGuidelines/Guidelines/FileContent/Preview/DHAHFG/DHA_part_b_intensive_care_general> (2 rules)
- **`DHA-MORT`**: DHA Health Facility Guidelines, Part B: Mortuary Unit. Dubai Health Authority. <https://services.dha.gov.ae/tahpi-app/HealthFacilityGuidelines/Guidelines/FileContent/Preview/DHAHFG/DHA_part_b_mortuary_unit> (8 rules)
- **`DHA-OBS`**: Obstetric and Neonatal Services inspection checklist (final inspection). Dubai Health Authority, 2023. <https://www.dha.gov.ae/uploads/122023/Obstetric%20and%20Neonatal%20Checklist-%20Final%20Inspection2023124630.pdf> (24 rules)
- **`DHA-DIAL`**: Renal Dialysis Services inspection checklist. Dubai Health Authority, 2023. <https://www.dha.gov.ae/uploads/032023/Renal%20Dialysis%20Checklist-%20Random%202023337276.pdf> (8 rules)
- **`PHILHEALTH-HD`**: PhilHealth Circular 20 s.2005, Annexes: hemodialysis facility standards. PhilHealth (Philippine Health Insurance Corporation), 2005. <https://www.philhealth.gov.ph/circulars/2005/miss/circ20_anxs.pdf> (4 rules)
- **`CDC-HD-2001`**: Recommendations for preventing transmission of infections among chronic hemodialysis patients (MMWR RR-50/5). US CDC, 2001. <https://www.cdc.gov/mmwr/preview/mmwrhtml/rr5005a1.htm> (0 rules)
- **`UKKA-HD`**: Clinical Practice Guideline: Haemodialysis, 5th edition. UK Renal Association / UK Kidney Association. <https://ukkidney.org/sites/default/files/haemodialysis-5th-edition.pdf> (4 rules)
- **`AAGBI-PACU-2013`**: Immediate post-anaesthesia recovery 2013. Association of Anaesthetists (AAGBI), 2013. <https://anaesthetists.org/Portals/0/PDFs/Guidelines%20PDFs/Guideline_immediate_post_anaesthesia_recovery_2013_final.pdf> (20 rules)
- **`WHO-SAFE-SURG`**: WHO Guidelines for Safe Surgery 2009 (anaesthesia monitoring & equipment standards). World Health Organization, 2009. <https://www.who.int/publications/i/item/9789241598552> (12 rules)
- **`NICE-CG65`**: Hypothermia: prevention and management in adults having surgery (CG65). NICE (UK), 2016. <https://www.nice.org.uk/guidance/cg65> (6 rules)
- **`WHO-DECON`**: Decontamination and reprocessing of medical devices for health-care facilities. World Health Organization / PAHO, 2016. <https://www.who.int/publications/i/item/9789241549851> (34 rules)
- **`WHO-O2`**: WHO-UNICEF technical specifications and guidance for oxygen therapy devices. WHO / UNICEF, 2019. <https://www.who.int/publications/i/item/9789241516914> (4 rules)
- **`WHO-BIOEQ`**: Biomedical equipment for COVID-19 case management: inventory tool. World Health Organization, 2020. <https://ifmbe.org/wp-content/uploads/2020/05/20200429_WHO-2020_Covid19_BioEquip.pdf> (8 rules)
- **`WHO-RMNCH`**: Interagency list of medical devices for essential interventions for reproductive, maternal, newborn and child health. World Health Organization, 2016. <https://www.who.int/publications/i/item/9789241565028> (18 rules)
- **`WHO-CANCER`**: WHO list of priority medical devices for cancer management. World Health Organization, 2017. <https://www.who.int/publications/i/item/9789241565462> (18 rules)
- **`WHO-CVD`**: WHO list of priority medical devices for management of cardiovascular diseases and diabetes. World Health Organization, 2021. <https://www.who.int/publications/i/item/9789240027978> (22 rules)
- **`EG-LAW-51`**: Law 51/1981 on medical establishments as amended by Law 153/2004 (equipment required where surgery under anaesthesia is performed, and in recovery rooms). Arab Republic of Egypt, 2004. <https://manshurat.org/node/30386> (16 rules)
- **`GAHAR-2021`**: GAHAR Handbook for Hospital Standards (EFS medical-equipment safety, NSR.27; ICD clinical deterioration, NSR.09). General Authority for Healthcare Accreditation and Regulation, Egypt, 2021. <https://gahar.gov.eg/upload/gahar-handbook-for-hospital-standards--2021-english-version-.pdf> (28 rules)
- **`GAHAR-NMEG`**: National Guide for Medical Equipment for Hospitals (announced 2025; not publicly downloadable; reconcile against GAHAR's equipment-list app). GAHAR, Egypt, 2025. <https://www.youm7.com/7125360> (0 rules)
- **`GETINGE-CSSD`**: CSSD planning FAQ: no international standard; sizing by procedure volume. Getinge. <https://planning.getinge.com/en/7faqs/> (4 rules)
- **`RCUK-QS`**: Requirements for resuscitation training and facilities for cardiovascular prevention and rehabilitation programmes. Resuscitation Council UK. <https://resus.org.uk/node/143> (2 rules)
- **`RCUK-PC`**: Quality Standards: primary care (incl. dental) equipment and drug lists. Resuscitation Council UK. <https://resus.org.uk/node/140> (4 rules)
- **`BIS-12433`**: IS 12433 (Part 2): Basic requirements for hospital planning, up to 100-bedded hospital. Bureau of Indian Standards, 2001. <https://law.resource.org/pub/in/bis/S09/is.12433.2.2001.pdf> (0 rules)

The ISCCM 2010 equipment list was read from a public mirror (pdfcoffee) whose table columns were partly garbled. Only the counts that read clearly (monitor per bed, 2 defibrillators, 1 ABG, 1 portable X-ray, 1 ultrasound, 1 bronchoscope, 2 RRT bed spaces per 12 beds) are cited.
