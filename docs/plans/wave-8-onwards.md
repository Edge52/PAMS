# Plan: wave 8 onwards — finishing wave 7, the "later" list, and what to add next

Status: **draft for discussion** · 3 November 2026 · after wave 7 merged to `main` (`a48ea45`)

This plan gathers everything not built yet, in one place:

- **Part A** — what wave 7 planned but left out or simplified;
- **Part B** — wave 7's *Later (not this wave)* list;
- **Part C** — the release 3.0 backlog (`docs/system-documentation.md`, *Backlog* and *Known limitations*);
- **Part D** — new features that fit the system and the way it's used (hospital equipment planning, tenders and
  imaging).

Part E puts them into waves. Part F lists what we need from you before starting.

Sizes: **S** = a day or two, **M** = about a week, **L** = two to three weeks, **XL** = more than a month or needs an
outside party. Sizes are for building and testing in the app, not for the data you have to collect.

---

## 1. Goals

1. **Close wave 7 properly.** Make pathways safe to rely on: checks that catch impossible routes, a printable sheet, and
   the small render options that were skipped.
2. **Make the 3D model a working tool every day.** Photos on notes, following a job from report to repair, faster
   routes on weak computers, coverage shown where facilities are managed.
3. **Close the money and tender gaps** that stop the system running a full procurement: budgets and commitments,
   invoices and three-way match, bonds, two-envelope opening.
4. **Arabic interface,** so the system can go to users who work in Arabic.
5. **Add features that help most in imaging and equipment planning.** These are the "will it fit" site planning for
   scanners, utilisation and replacement planning, and tender comparison by technical spec.
6. **Prepare the integrations** that the larger "later" items need, without blocking on them: hospital information
   system (HIS), location tags, building models.

---

## Part A — Wave 7 carry-over

### A1. Pathway checks that catch impossible routes (M)

Today's checks cover the pathway's structure (start, end, shares, loops). Add checks that need the building:

| Check | Level | How |
|---|---|---|
| A bed or trolley leg with no bed lift on its route between floors | Error (blocks publishing) | Route the leg as a bed journey; no route → error |
| A leg whose only route passes through a room the traveller may not enter (sterile, isolation, staff only for a patient on foot) | Warning | Route with the zone rules; note the room it passes |
| A step whose room was removed or renamed by a drawing update | Error | Step rooms keep their code; the drawing update lists affected pathways and marks the steps |
| A step whose room is on no floor's walking network | Warning | Network coverage per room |
| A leg estimated (part not on the network) | Warning, with *Fix* | Link to the 3D Routes panel on that floor |
| Equipment codes that don't exist in the catalogue | Warning | Look up device type codes |

- Checks that need routes run on the server, using the same routing code as the 3D view (it's pure TypeScript). They
  are cached per pathway version and recomputed when fixes, zones, lifts or drawings change.
- The drawing update review (Facilities › Update drawings) gains a section: *pathways affected*.

### A2. Printable pathway sheet (S)

One A4 page per pathway, landscape: diagram, steps table (place, time, who goes, equipment, patients a day), legs
(distance, time, lift), equipment readiness, assumptions, version and who published it. Print or save as PDF, like
the other printable sheets. Also a *Pathway book*: every published pathway of a hospital, with a contents page.

### A3. Lift waits by time of day (S)

Each lift core gets an optional wait per hour (24 values, defaulting to the single wait). Routes use the hour of the
journey: the pathway's busiest hour for analysis, and the current hour for *nearest working device*. The editor shows
a small bar chart of the day.

### A4. Route from a fault to the workshop (S)

Mark one or more rooms as the biomedical workshop (a room flag, per facility). A fault's work order shows the walking
route and time from the workshop to the device, with lift and stairs. Technicians' phones get a *Show route* link
that opens the 3D view on that route.

### A5. Coverage on the Facilities page (S)

The facility page gets a *Walking network* tab:

- coverage per floor (rooms reached, assumed doors, unreachable rooms);
- route fixes and zones as lists;
- a *Rebuild* button.

The coverage figures come from the server, using the same code as the 3D view, and are cached per floor.

### A6. Routes off the main thread (M)

Network building and A* run in a Web Worker in the browser. The 3D view stays smooth while a floor's network builds,
and several pathways can route in parallel. The worker uses the same modules as today, with no new packages.

### A7. Clean and dirty routes (M)

With supply (clean) and waste (dirty) pathways set up, flag:

- corridors where clean and dirty flows share a stretch;
- lifts used by both;
- the same lift used in the same hour.

Results show as a layer in 3D, red where they cross, and in the analysis report. Starters are added: *clean supplies
from CSSD to theatres* and *waste from wards to the waste store*.

### A8. Photos on notes (S)

Attach photos to a note, from the camera on a phone or tablet, or from a file. They're stored like other documents
(the existing documents store), shown as thumbnails on the note and in the hover card, and copied to the work order
when the note becomes one.

### A9. Follow a job in the model (S)

From a work order: *Show in 3D* flies to the device, with the job's progress (reported → assigned → in progress →
done) as a ribbon above it. In the 3D view a *Jobs* layer shows open jobs by status colour. A job that's been open
longer than its response time pulses.

### A10. Render options left out (M)

- **More views:** eye level (from a chosen room) and the current camera, besides dollhouse, isometric and plan.
- **Labels:** room names, department names, both or none. Department names are drawn once per department, at its
  middle.
- **People figures:** a few simple standing and sitting figures, for scale; off by default.
- **Output:** JPEG or PNG; a ZIP of the floor book's images.
- **Documents:** *Save to the hospital's documents* stores a render or a floor book PDF with the facility.
- **Models:** better furniture and equipment models from openly licensed (CC0) libraries, kept small. A licence list
  goes in `docs/` before anything is bundled. Today's models stay as the fallback.

### A11. Department-scoped editing of pathways (M)

Wave 7 noted this as a new kind of permission. Users get an optional list of departments. A department head can edit
pathways whose steps all sit in their departments, and notes and zones in their rooms. Everything else stays as today.

---

## Part B — Wave 7's "Later" list

### B1. Arabic interface (L)

See C3; the same piece of work.

### B2. Real volumes and waiting times from the hospital information system (XL, needs the HIS vendor)

- **Import first, live later.** A CSV/Excel import of daily encounters by department and hour (ER arrivals,
  admissions, theatre cases, imaging exams) feeds pathway volumes and arrival profiles. Analysis then shows *measured*
  next to *assumed*.
- **Live link.** When the HIS can send it, the same through an HL7 v2 (ADT, ORM) or FHIR (Encounter, ServiceRequest)
  feed. For imaging, modality worklist and performed-procedure (MPPS) data give real exam counts and room times per
  scanner (see D3).
- **Privacy.** Only counts and times per hour are stored, never patient identities.

### B3. Queue simulation (L)

A discrete-event simulation of a pathway over a typical day or week. Patients arrive by the arrival profile and wait
for rooms, beds, scanners, staff and lifts. It reports waiting times, queue lengths and utilisation by hour, with
confidence ranges over many runs.

- It runs in the browser (a Web Worker) or on the server, in seconds, for a hospital-sized model.
- Results show next to the load figures in 7d, which stay as the quick check.
- *What-if* comparisons: one more CT, a second bed lift, a step moved to another floor.

### B4. Real-time location of mobile equipment (XL, needs hardware)

Equipment tags (BLE, UWB or Wi-Fi RTLS) report a room or position. The system:

- shows the device's last seen room and time;
- moves it in the register when it stays in a new room (with a log, like a move today);
- finds the nearest working device by where it really is;
- alerts when a device leaves its department or the building.

The import and API are built first, so a pilot with one vendor's tags (a single ward's pumps, say) can start without
redesign. A simulated feed is used for testing.

### B5. Building services (MEP) layers (L)

Import services from the CAD drawings' layers (medical gases, electrical, HVAC, water, nurse call, data) as 3D lines
and points per floor. Show them as layers. Link outlets to rooms ("this ICU bay has 2 oxygen, 1 air, 2 vacuum") and
check them against room data sheets (C1). Uses the same CAD pipeline (`tools/cad`) with new layer rules per drawing
set.

### B6. BIM (IFC) import and campus view (XL)

Import IFC models (rooms as `IfcSpace`, walls, doors, levels, equipment as `IfcFlowTerminal`/`IfcFurnishingElement`).
Rooms then come with real heights and the building has its exterior. This gives:

- **Exterior and façade renders,** left out of Part F because floor plans can't give them.
- **A campus view:** several buildings placed on a site plan, with routes between them.
- **Reading equipment from a BIM model:** for new hospitals designed in BIM, so the BOQ can start from the model.

---

## Part C — Release 3.0 backlog (still open)

### C1. Procurement and BOQ depth (L, in parts)

| Piece | What | Size |
|---|---|---|
| BOQ scope from CAD rooms | Rooms by type counted from the imported drawings feed the BOQ (beds, ICU bays, theatres, imaging rooms) instead of typing them | M |
| Room data sheets | Per room type: area, services, finishes, equipment list (from standards). Per room: a sheet printed from the drawing and the BOQ, with what's planned, installed and missing | M |
| Budgets and commitments | Budget lines per project or department and year. POs commit against them; invoices spend. Warnings at 80 % and 100 % | M |
| Invoices and three-way match | Supplier invoices against PO and goods received; differences flagged; approval; export for finance | M |
| Framework agreements and call-offs | Agreed prices and ceilings per supplier; call-off POs without a new tender, within the ceiling | M |
| Supplier scorecards | Delivery on time, installation and acceptance issues, warranty response, from the records the system already keeps | S |
| Delivery, installation and acceptance checklists | Per device type, signed by biomedical engineering and the user department; acceptance starts the warranty | S |
| Several contacts per supplier | Contacts with roles (sales, service, finance), used in RFQs and notifications | S |

### C2. Tender law depth (M)

- **Two-envelope opening** (Law 182/2018, art. 23): technical envelopes opened and evaluated first, financial ones
  opened only for technically accepted bids, with the opening minutes.
- **Bonds:** a bid bond of 1.5 % and a performance bond of 5 % (art. 16 and 40), with amounts, expiry and release
  tracked and alerts before expiry.
- **Validity extension letters** (art. 27): the letter generated from the offer.
- **Committee minutes:** printed from the system (opening, technical evaluation, financial evaluation, award), in the
  official layout.
- **E-procurement portal export:** later, once the portal's format is known.

### C3. Arabic interface (L)

- **Layout and screens:** right-to-left; every label in Arabic and English, with a language switch per user.
- **Printouts and reports:** bilingual, where the document needs it.
- **Names and numbers:** Arabic names from the register, Arabic numerals as a choice, dates in the Egyptian format.
- **Renders and floor books:** Arabic room and department labels (A10).

The work: extract all user-facing text into message files, translate with your team's terms (the glossary we started
with *Arabic names*), test every page at phone width in both directions.

### C4. Platform (M each)

| Piece | What |
|---|---|
| Microsoft or Google sign-in | SSO for hospital staff, mapped to roles; password sign-in stays for others |
| ERP and finance export | POs, invoices, assets (capitalisation) and depreciation, as files or an API for the hospital's finance system |
| Audit log viewer | Search the activity log by person, record and date; export |
| Polygon rooms on the 2D map | Draw and edit room outlines by hand, not only rectangles |
| Moving devices between floors on the 2D map | Drag a device to a room on another floor (today: from its page or in 3D) |
| Maintenance budget view | Maintenance and parts cost per device, department and year against a budget, with forecasts from PPM plans |
| Backups and restore page | Scheduled database backups with a restore check, shown to administrators |
| Go-live hardening | A full Docker build on the real server; email through the hospital's mail server; load test with real data size |

### C5. 3D extras from the backlog

- **Commissioning timeline:** for a new building or wing, which rooms are delivered, installed and accepted, by week.
  It's shown as a time slider (built on wave 7's history) and as a Gantt in the project.
- **MEP layers, BIM and campus, real-time location:** see B4–B6.

---

## Part D — New features worth adding

These are suggestions. Each one builds on data the system already holds.

### D1. "Will it fit?" site planning for scanners and large equipment (M–L) — *recommended first*

For CT, MRI, X-ray, C-arm, angiography and linear accelerators, the manufacturer's site planning data per model:

- room size, ceiling height and door size;
- floor load and weight;
- power, cooling and heat output;
- shielding, and for MRI the magnetic field lines (5 gauss and 0.5 mT).

In 3D, place the model in a room:

- **Fit:** the footprint and service clearances show green or red;
- **MRI:** the 5-gauss line is drawn as a shape on the floor plan, and rooms it reaches are listed;
- **Report:** what's missing (ceiling too low, door too narrow, floor load too high, no chilled water).

The result is a one-page *site readiness* sheet per room and model, for tenders and installation. The data is entered
per device model in the catalogue (the model pages exist), starting with the models you quote most. Planned BOQ
equipment can be checked room by room before the tender.

### D2. Technical comparison of offers against the specification (M)

The specification's clauses (from *Specs*) become a compliance matrix. Each offer is marked complies / partly / doesn't
for each clause, with the page reference from its datasheet. The system then:

- totals the result per offer and highlights critical clauses that aren't met;
- prints the technical evaluation sheet the committee signs;
- adds a weighted score (technical and price) where the tender uses one.

Useful on both sides: evaluating offers for a hospital, and checking a supplier's own offer against a tender before
submitting.

### D3. Imaging utilisation and capacity (M, more with HIS data)

Per scanner:

- exams per day and week, uptime, downtime and the reasons for it;
- exams per hour of uptime;
- **utilisation** against the planning capacity (12,000 a year for CT, 6,000 for MRI, …), from manual entries, an
  import, or later MPPS/HIS data.

Combined with work orders, the dashboard shows:

- lost exams from downtime;
- days since the last fault;
- the busiest scanners;
- which scanners will pass their service life in the next two years.

This feeds replacement planning (D4) and tender justifications ("CT 2 ran at 118 % of planned capacity in 2026").

### D4. Replacement and capital plan (M)

A 5- or 10-year capital plan per hospital. It builds on the existing replacement page:

- each device's end of life, downtime, repair cost against value, and parts no longer supported;
- these give a priority score and a year;
- costs are grouped by year and department, with a budget line to compare;
- out comes a ranked list to turn into a BOQ or a tender with one click.

### D5. Total cost of ownership in offer comparison (S–M)

Offers compared not only on price but over 5–10 years:

- service contract and spare parts;
- consumables, energy, and helium where it applies;
- downtime cost.

Values come from the offer's commercial terms and the system's own maintenance history for similar models. This fits
both tender evaluation and commercial deal structuring.

### D6. Service contract performance (S)

For devices under contract, against the contract's terms:

- response and repair times;
- uptime guarantee;
- penalties due.

Built from work orders and downtime, which the system already records. The result is a monthly statement per
supplier, with penalties calculated.

### D7. Mobile rounds and stock-take (M)

A phone page for walking rounds: scan a device label (QR, labels exist), confirm it's in this room and working, report
a fault or move it in two taps. It works with a poor signal and syncs later. For a stock-take, a ward is checked
device by device, missing ones are listed, and the 3D view shows what was confirmed and when.

### D8. Recall and safety-notice matching (S)

When a recall or field safety notice is entered (recalls exist), the system matches it by manufacturer, model and
serial range. It lists affected devices with their rooms and shows them in 3D. It then tracks each one to closed and
notifies the departments.

### D9. Department view and requests (M)

A simple page for department heads: their equipment, open jobs, upcoming maintenance, devices past service life. They
can request new or replacement equipment with a reason. Requests flow into the capital plan (D4) and the BOQ, with
approvals.

### D10. Executive dashboard pack (S)

A one-page monthly pack for management:

- uptime of critical equipment;
- open faults and overdue maintenance;
- tenders in progress and spending against budget;
- pathway readiness;
- the top risks.

It's printable and can be emailed on a schedule.

### D11. Assistant for searching and drafting (M, optional)

An assistant inside the app that answers questions from the system's own data ("which ventilators in ICU are past 10
years?"). It also drafts letters, specs and evaluation text for a person to edit. It would be off by default and use the
same privacy rules as the AI finish you declined for renders: nothing leaves the server unless an administrator turns
it on. Listed for completeness; skip it if you'd rather not have AI in the system.

---

## Part E — Proposed waves

Order: finish what wave 7 started, then the items with the most day-to-day value, then the big integrations, which
depend on outside parties.

| Wave | Contents | Size | Depends on |
|---|---|---|---|
| **8 — Finish and harden** | A1 pathway checks, A2 pathway sheet, A3 lift waits by hour, A4 workshop route, A5 coverage page, A8 photos on notes, A9 jobs in 3D, A10 render options; C4 go-live hardening | L | — |
| **9 — Imaging and equipment planning** | D1 site planning (*will it fit*), D3 utilisation, D4 capital plan, D5 TCO, D6 contract performance, D8 recall matching | L | Site planning data for the first models (you) |
| **10 — Money and tender law** | C1 budgets, invoices and three-way match, framework agreements, scorecards, acceptance checklists; C2 two-envelope opening, bonds, minutes; D2 technical compliance matrix | L | Confirmation of Law 182 details; finance export format |
| **11 — Arabic interface** | C3 / B1 Arabic interface, bilingual printouts, Arabic render labels | L | Your team's terms list |
| **12 — Operations** | A6 routes off the main thread, A7 clean and dirty routes, A11 department-scoped editing, D7 mobile rounds and stock-take, D9 department view and requests, D10 executive pack, C4 SSO, audit log viewer, polygon rooms, floor-to-floor moves on the map, backups, maintenance budget, several supplier contacts, C1 room data sheets and BOQ scope from CAD | L | Hospital's identity provider for SSO |
| **13 — Simulation and services** | B3 queue simulation, B5 MEP layers, C5 commissioning timeline | L | MEP layers in the drawings |
| **Pilots (when partners are ready)** | B2 HIS volumes (import first), B4 real-time location (one ward), B6 BIM/IFC and campus | XL each | HIS vendor; RTLS vendor and tags; an IFC model |
| **Optional** | D11 assistant | M | Your decision |

Every wave ends like the earlier ones:

- unit tests, and browser tests for each feature;
- a crawl of every page for each role at phone width;
- CHANGELOG and docs updated;
- push to a branch; your OK before `main`.

---

## Part F — Decisions and inputs needed

| Question | My suggestion |
|---|---|
| Which wave first? | 8 (finish and harden), then 9 (imaging and equipment planning), which is closest to your daily work |
| Site planning data (D1): which models first? | The models you quote most (CT, MRI, C-arm, DR). Manufacturers' site planning guides give the figures; I can set up the form and a sample from one public guide |
| Pathway checks (A1): should a bed leg with no bed lift block publishing? | Yes (as wave 7 suggested); everything else stays a warning |
| Arabic (C3): who confirms terms? | Your team, from a glossary sheet I prepare from every label in the app |
| HIS (B2): which system does La Plaza use, and who's the contact? | Start with the import (CSV/Excel), which needs no vendor |
| RTLS (B4): is a tagging pilot likely? | If not in the next year, keep only the import/API groundwork |
| Assistant (D11): wanted? | Optional; your call |
| Department heads editing (A11): wanted now? | Only if department heads will maintain pathways themselves |

---

## Appendix — where each item came from

| Source | Items |
|---|---|
| Wave 7 plan, built partly or not at all | A1–A11 |
| Wave 7 plan §10 *Later* | B1–B6 |
| `docs/system-documentation.md` *Backlog* and *Known limitations* | C1–C5 |
| New | D1–D11 |
