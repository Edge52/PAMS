# Hospital PAMS — System Documentation (release 3.0)

1 Nov 2026 · supersedes the release 2.1 document of 30 Oct 2026

## Summary

Hospital PAMS is one web application for planning, buying, tracking and maintaining a hospital's medical equipment.
Release 3.0 adds waves 3 to 6 to the 2.1 pilot release: the biomedical engineering workflow, a 3D view you can work from,
quick and checked BOQ planning, tidy register data entry, and planning figures checked against published sources.

| Area | State at release 3.0 |
| --- | --- |
| Plan | BOQs from ratio standards or a quick-start wizard; workload sizing, special conditions, companion items; price tiers and scenarios; fit to budget, benchmarks, risk flags, room requirements against CAD rooms; phasing, cash flow and cost of ownership |
| Procure | Specs, RFQs, offers, compliance, scoring, Law 182 committees, award approval, POs, goods receipt (unchanged since 2.1) |
| Track | Asset register with makes and models, tags and fleet standardisation; floor map; 3D view with problem layers, live status, plan vs installed, nearest device, saved views, two looks and section cuts |
| Maintain | Fault reports and work orders, PPM with checklists, service contracts and warranty claims, spare parts, recalls (FSCA), disposal, replacement plan, device KPIs |
| Govern | Sign-in, 9 roles, facility limits, approval chains (POs, BOQs, awards, disposals), notifications, 6 reports incl. an executive summary, global search |
| Run | Laptop launchers (demo or own data); Docker server with HTTPS and daily backups; `cad:load` and a going-live checklist |

Size: about 39,400 lines of TypeScript, 56 database tables, 78 screens and 8 download/data routes, with 402 automated
tests and a browser test per feature. Migrations `0000`–`0015`.

How to read this document: *Modules* says what works today; *Roles* who may do what; *Running* how to install and update;
*Codebase* where things live; *Known limitations* and *Backlog* what is left and what only you can decide.

## Architecture

One Next.js server process serves every screen. The modules (planning, procurement, assets and maintenance, facilities)
share six services: approvals, notifications, reports, documents (attachments), the activity log and search. Every page,
server action and file download passes the sign-in and permission check first; records that belong to a hospital also
check the user's facility access.

Data lives in PostgreSQL 16 (server) or embedded PGlite (laptop). Uploaded files live in `UPLOAD_DIR`. The CAD tool
(`tools/cad`) runs offline: it turns DWG plans into a building file that the seed or `npm run cad:load` brings in.

The 3D view runs in the browser (three.js); it loads the building, then streams floor linework and refreshes device
status every minute through three small data routes.

## The record trail

Each record keeps a link to the one before it:

**BOQ line → RFQ line → offer line → award → PO line → delivery → asset → work orders and maintenance → disposal**

From any device you can open its PO, offer, tender and BOQ line; from any BOQ line, see what was installed (BOQ tab or
the 3D view's *Plan vs installed*). The device type (one of 788 in the shared catalogue) and, since 3.0, its make and
model travel along the whole trail.

The 56 tables fall into eight groups:

- **Reference:** device types (with PPM checklists), makes and models, department types, standard sets and ratio rules
  (with workload and condition rules), companion items, exchange rates.
- **Places:** facilities, buildings, floors with CAD linework, departments, rooms.
- **Planning:** BOQs (features, price tier, target budget, phasing), BOQ departments (planning answers, tier, phase), BOQ lines.
- **Procurement:** projects, specs and spec items, RFQs, offers with lines and compliance, committees and members,
  purchase orders and lines, deliveries.
- **Assets:** assets (with tags), movements, maintenance events, preferred models.
- **Maintenance:** work orders, service contracts and their devices, spare parts and stock movements, recalls and
  affected devices, disposals.
- **Governance:** users, sessions, facility access, approval rules, requests and steps, notifications, settings,
  document numbering, saved 3D views.
- **Shared:** documents (attachments) and the activity log.

## Modules

### Planning: BOQs (`/boq`)

- A BOQ is built from department scope (beds, rooms, procedure rooms) and a standard set of equipment ratios: per bed,
  per room, per department, per hospital bed or fixed. Every quantity shows its calculation; manual overrides survive
  regeneration. Status: draft → under review (frozen) → approved (locked) → superseded by a new version.
- **Quick start** (`/boq/quick-start`): a 7-step wizard — hospital type (general, specialised, teaching, women and
  children) and ownership, beds (ICU, CCU, NICU, isolation from the template), services (emergency, theatres, cath lab,
  CT, MRI, dialysis chairs, deliveries a year, clinics…), special conditions (trauma centre, teaching, NICU level III,
  cardiac surgery, oncology, stroke), price tier and target budget — then a priced preview before anything is saved.
- **Workload sizing**: departments answer planning questions (CT/MRI/X-ray/ultrasound exams, deliveries, endoscopies,
  cath procedures, lab tests a year). Rules size equipment from them (1 CT per 12,000 exams a year). 0 = none planned.
- **Special conditions** add equipment only when the BOQ has the feature; **companion items** (CT → injector, delivery
  bed → CTG and infant warmer) are topped up to what each department lacks.
- **Price tiers**: basic, standard and premium from each device type's catalogue price band, set for the BOQ, a
  department or one line; scenarios side by side against the target budget. Repricing never overwrites a price typed by hand.
- **Checks** tab: risk flags (single CT/MRI/cath lab, ICU short of ventilators, critical areas without monitors or a
  defibrillator, essential items removed, over budget, unpriced lines, single-maker life-critical fleets); fit to budget
  (drops optional items, then moves recommended lines a price tier down; never touches essential lines or hand-typed
  prices; you approve the list); room requirements (CT, MRI, angiography, X-ray, theatres… against real room areas from
  the floor plans); benchmarks (equipment per bed, room or 100 hospital beds against reference ranges).
- **Phasing & costs** tab: departments in up to four opening phases, cash flow by quarter (advance with the order,
  ordered ahead by device lead time, rest on delivery) and 5- and 10-year cost of ownership.
- **Plan vs installed** tab, Excel export, approvals, versions. Standards and ratios are editable under Standards & ratios.
- **Reference figures**: every workload rate, range, room size, running-cost rate and lead time is registered with its
  status and sources in `src/lib/boq/reference-figures.ts` and listed in `docs/reference-figures-review.xlsx`
  (see `docs/reference-figures.md`).

### Procurement and tenders (`/procurement`)

Unchanged since 2.1:

- Projects (tenders), suppliers, technical specifications per device type (printable).
- RFQs freeze items and quantities from a BOQ; offers with prices, incoterms, delivery, warranty and a line-by-line
  compliance matrix; comparison in the project currency with a weighted technical and financial score.
- Committees under Law 182/2018 (opening and adjudication, or one combined committee up to EGP 300,000) with the
  required members and warnings; award recommendation signed by the voting members, approved by the competent authority;
  7-day complaint window and acceptance notice.
- Purchase orders through approval to issue; goods receipt creates tagged assets linked to their PO line.

### Assets and maintenance (`/assets`)

- **Register**: tag (e.g. `LPH-MON-000042`), device type, make, model, serial, status, condition, criticality, cost,
  warranty, **tags**, location down to room. Filters (incl. `?tag=`), CSV export. Add singly, in bulk (one per bed), by
  Excel import or from goods receipt; equipment forms offer the catalogue's makes and models as you type. QR labels.
- **Floor map** (2D) and **3D view** (below). Every move is recorded.
- **Work orders** (`/assets/work-orders`): anyone reports a fault from the device page or its QR label (phone friendly);
  the biomedical engineer assigns; the technician starts, holds, completes (work done, parts, downtime); the engineer
  closes. Response targets by priority, KPIs (open, overdue, response on time, mean time to repair, between failures),
  and the device's status follows (a critical fault takes it out of service). Completing writes the maintenance record.
- **Planned maintenance**: due list and schedule from each device type's interval; "Create PPM jobs" turns due visits
  into work orders carrying the device type's checklist (pass/fail/measured value per check).
- **Service contracts** (`/assets/contracts`): devices covered, dates, response time, value; each job shows warranty,
  contract or no cover, with claim status. Contracts ending within 60 days notify.
- **Spare parts** (`/assets/parts`): stock per hospital with minimum levels; receipts, issues to jobs, adjustments; never
  below zero; low stock notifies; parts cost on each job.
- **Recalls** (`/assets/recalls`): match devices by type, maker, model and serials; inspection jobs; each device tracked
  to actioned or not affected.
- **Disposal** (`/assets/disposals`): request → approval (director by default) → record; the device is condemned on
  approval and disposed when recorded (no open jobs allowed).
- **Replacement plan** (`/assets/replacement`): score 0–100 from age against life, repair cost, failures, downtime,
  criticality and condition; selected devices become a draft replacement BOQ.
- **Device performance** on each asset page: uptime, failures, MTBF, MTTR, maintenance and parts cost against price.
- **Fleet & standardisation** (`/assets/fleet`): makes and models per device type, share on the most common model,
  units out of maker support or without a model, and the hospital's preferred model per type.

### Device catalogue (`/catalogue`)

788 device types (category › group › type) with Arabic names, risk class, criticality, life, PPM interval, price band,
specification template and PPM checklist. **Makes and models** (`/catalogue/models`): brands and models per type with
reference price, end of sale and end of support; built from the register in one click; retire/restore.

### Facilities, floors and CAD (`/facilities`)

Facilities › buildings › floors › departments › rooms. Rooms drawn by hand or imported from CAD with their real
outlines. La Plaza Hospital: 9 floors (5 m floor to floor), 29 departments, 1,414 rooms, 208 beds; the demo fit-out of
1,475 devices is generated from room names. For a live installation, `npm run cad:load` loads the building without
demo equipment.

### 3D view (`/assets/3d`)

- **Building**: every floor from the DWG plans (walls 3.3 m, doors, glazing, columns, room outlines in department
  colours). Lifts, stairs and shafts rise through the building; a glass façade traced from the rooms wraps it from afar.
  Basements fold away unless shown. The linked floor loads first; the rest stream in.
- **Two looks**: the glowing *digital twin* and a light *architectural* style (remembered per browser).
- **Readable from afar**: walls drawn low over the whole building, floor names beside the model, department names on
  the floors; full walls, doors and room names on one floor or close up.
- **Devices**: life-size models close up (bed, monitor, ventilator, scanner, pump) on a ring in their status colour;
  glowing dots from afar; faults pulse; statuses refresh every minute.
- **Problem layers**: open faults, overdue maintenance, past service life, downtime, equipment value or open recalls, by
  room or department, as a smooth heat map or blocks, with a legend and the most affected places.
- **Act from the model**: report a fault, record maintenance, open jobs, move a device or set its exact spot; list a
  room's equipment or add a device.
- **Plan vs installed**: a BOQ's planned equipment against the register, rooms coloured by completeness, missing units
  as wireframe ghosts. **Nearest working device** from a room, with the route through lifts or stairs.
- **Camera**: isometric, plan (top-down) and eye level presets; section cut east–west or north–south; saved views
  (private or shared), share links and high-resolution images.
- Works on phones (bottom sheet) and switches slow devices to lighter graphics.

### Approvals (`/approvals`)

One engine for POs, BOQs, awards and (since 3.0) disposals. Defaults: procurement manager for every PO, Finance from
EGP 1M, director from EGP 2M; director for disposals. The submitter can't approve, nobody approves two steps of one
request, rejections need a comment, every step needs an eligible approver, one open request per record.

### Notifications (`/notifications`)

Bell, inbox and optional email (hospital SMTP). Hourly alerts: offers expiring (Law 182 art. 27), RFQs closing, late
POs, warranties ending, maintenance due or overdue, acceptance notices due, service contracts ending, spare parts below
minimum. Large groups arrive as one summary; approval alerts clear when decided.

### Reports (`/reports`)

Executive summary (one printable page per hospital: what needs attention, availability, maintenance performance,
contracts, deliveries, approvals), tender status, open purchase orders, assets by department, warranty expiries, PPM
compliance. Filters, Excel export, print layouts.

### Search (`/search`)

One box on every page: equipment (tag, serial, maker, model, tags), device types, makes and models, rooms,
departments, work orders, suppliers, tenders, purchase orders and BOQs — within the user's permissions and hospitals.

### Administration (`/admin`)

Users (role, facilities, on/off, password reset); approval rules and settings (PO, BOQ, award and disposal rules, Law 182
thresholds and day counts, quorum, alert windows, email, demo accounts on the sign-in page).

## Roles and permissions

Everyone signed in can read and report a fault; the role decides what else they can change. Approval steps are decided
by the role or person named on them, so an administrator can't approve just by being an administrator.

| Role | Can change | Typically approves |
| --- | --- | --- |
| Administrator | Everything, plus users and settings | — |
| Director (competent authority) | Nothing directly | Awards, POs from EGP 2M, BOQs, disposals |
| Procurement officer | Projects, specs, RFQs, suppliers, offers, award recommendations, POs, receiving, service contracts | First step of every PO |
| Finance | Nothing directly | POs from EGP 1M |
| BOQ planner | BOQs and BOQ standards | — |
| Biomedical engineer | Assets, maintenance, work orders (assigns and closes), PPM checklists, contracts, spare parts, recalls, disposals, facilities and rooms, catalogue and makes and models, specs, BOQs, receiving | — |
| Technician | Asset moves, maintenance records, working assigned jobs and booking parts | — |
| Department head | Read only, report faults | — |
| Viewer | Read only, report faults | — |

Users can be limited to selected hospitals; every list, map, 3D view, report, search result, download and attachment
then shows only those. The matrix is one file: `src/lib/auth/permissions.ts`. Demo accounts: one per role at
`@demo.hpams`, password `demo1234`.

## Running and deploying

|  | Laptop | Server |
| --- | --- | --- |
| Start | **Start demo.command** / **Start Hospital PAMS.command**, or `npm run demo` / `npm run local` | `docker compose up -d --build` |
| Database | Embedded PGlite (`.pglite` demo, `.pglite-data` own data) | PostgreSQL 16 |
| Address | http://localhost:3000 | https://your-domain (certificate automatic) |
| First use | Demo: pick an account. Own data: create the administrator | Enter `SETUP_CODE`, create the administrator, then `docker compose exec app npx tsx scripts/load-buildings.ts` for the floors |
| Backups | `npm run backup` with the app stopped | Daily dump and uploads archive in `./backups`, 14 days |
| Needs | Node.js 22 or newer | Docker, a domain, ports 80 and 443 |

Settings in `.env`: `DATABASE_URL`, `DOMAIN`, `POSTGRES_PASSWORD`, `SETUP_CODE`, `APP_URL`, `APP_TIME_ZONE`,
`UPLOAD_DIR`, `SMTP_URL` and `MAIL_FROM` (hospital mail), `TRUST_PROXY`.

Updating: pull the code and start again (`npm run demo`, `npm run local` or `docker compose up -d --build`). Migrations
apply on start and seeding updates reference data (catalogue, standards, quick-start rules) without touching your
records. The going-live checklist, with example mail settings, is in `docs/deploy.md`.

## Codebase map and conventions

Stack: Next.js 16 (App Router, server actions), React 19, TypeScript strict, Tailwind 4, Drizzle ORM on PostgreSQL 16
or PGlite, three.js for 3D, ExcelJS, Vitest, Playwright for browser checks.

| Path | What lives there |
| --- | --- |
| `src/db/schema.ts`, `drizzle/` | Data model (56 tables) and migrations 0000–0015 |
| `src/lib/auth/` | Passwords, sessions, permission matrix, facility scope, route guard |
| `src/lib/approvals/` | Approval engine (pure rules, database side, effects, defaults) |
| `src/lib/procurement/`, `src/app/procurement/` | Tenders, specs, RFQs, offers, committees, POs, receiving |
| `src/lib/boq/`, `src/app/boq/`, `src/components/boq/` | BOQ engine and generation; quick start (`questions.ts`, `templates.ts`); pricing; checks (`fit-budget.ts`, `benchmarks.ts`, `risks.ts`, `room-requirements.ts`); planning (`tco.ts`, `phasing.ts`); reference register (`reference-figures.ts`) |
| `src/lib/assets/`, `src/app/assets/` | Register, map, maintenance; work orders, checklists, contracts, parts, recalls, disposal, lifecycle KPIs, plan vs installed, makes and models, tags (pure `*.ts` + `*-server.ts`) |
| `src/app/catalogue/`, `src/app/facilities/` | Device catalogue, makes and models; facilities and layout editor |
| `src/components/assets/twin/` | 3D view: `scene.ts` (three.js), `twin-view.tsx` (panels), `geometry.ts`, `layers.ts`, `nearest.ts`, `view-state.ts`, `hud-state.ts` |
| `src/lib/notifications/`, `src/instrumentation.ts` | Notifications, email, alert rules, hourly scheduler |
| `src/lib/reports/`, `src/app/reports/` | Reports, executive summary, Excel export |
| `src/lib/search.ts`, `src/app/search/` | Global search |
| `seed-data/` | Taxonomy, BOQ standards, quick-start rules, department types, La Plaza CAD building |
| `scripts/` | Migrations, seeds (incl. demo plan and models), launcher, backup, `load-buildings.ts`, `reference-sheet.ts` |
| `tools/cad/` | DWG → building pipeline (offline) |
| `docs/` | This document, user guide, deployment, reference figures, taxonomy, BOQ standards |

Conventions (full text in `AGENTS.md`): permission check first in every page and action, facility access on records,
facility scope on lists; zod-validated server actions, then `logActivity` (inside a transaction pass the actor and the
transaction); assets only through `createAsset`; stock only through `applyMovement`; notifications only through
`notifyUsers`/`notifyRole`; pure rules in their own files with unit tests; schema change = edit `schema.ts`,
`npm run db:generate`, commit the migration. Checks before a release: `npm run typecheck`, `npm run lint`, `npm test`,
browser tests, a crawl of every page for every role at phone width, a production build.

## Quality

At release 3.0: 402 unit tests pass; browser tests for every wave-3 to wave-6 feature pass; a crawl of 76 pages for each
of the 10 demo accounts at phone width finds no errors or horizontal scrolling; the server log shows no database errors.

## Known limitations

| Area | Limitation |
| --- | --- |
| Data | La Plaza's equipment and fit-out plan are demo data; the real register is to be entered after launch. Planning figures marked *judgement* in the reference sheet await your team's confirmation. |
| Money | No budgets, commitments, invoices, payments or three-way match; maintenance costs are totalled per device and job but there is no maintenance budget view. |
| BOQ scope | Beds and rooms are entered by hand (or by the quick start), not counted from CAD; no room data sheets. |
| Language | English interface; Arabic names stored and shown, no right-to-left interface. |
| Tender law | Two-envelope opening, bid and performance bonds and the e-procurement portal are not modelled. |
| Suppliers | One contact per supplier. |
| 3D | Distances for "nearest device" are straight lines plus a fixed cost per storey; lifts and stairs are found from room names; no MEP layers, BIM import or real-time location. |
| Hand-drawn rooms | Rectangles only (CAD rooms keep real outlines). |
| Integrations | No ERP, finance, HIS or Microsoft/Google sign-in. |
| Not yet tried for real | A full Docker build on a server, email through the hospital's mail server. |

## Backlog

| Package | Contents | Size |
| --- | --- | --- |
| Procurement and BOQ depth (2.3) | BOQ scope counted from CAD rooms; room data sheets; budgets and commitments; framework agreements and call-off POs; invoices and three-way match; supplier scorecards; delivery, installation and acceptance checklists | L |
| Tender law depth | Two-envelope opening (art. 23), bid bond 1.5 % and performance bond 5 % (art. 16, 40), validity extension letters (art. 27), committee minutes printed from the system | M |
| Arabic interface | Right-to-left screens, Arabic labels, bilingual printouts | L |
| Platform | Microsoft or Google sign-in; ERP/finance export; audit log viewer; several contacts per supplier; polygon rooms | M each |
| 3D extras | Commissioning timeline; building services (MEP) layers; IFC/BIM import and campus view; real-time location of mobile equipment | M–L each |

## Decisions and inputs needed

- **Reference figures**: return `docs/reference-figures-review.xlsx` with agreed values (especially the *judgement* rows).
- **Go-live**: the cloud server and domain; the hospital mailbox (SMTP) for notifications; the list of users with roles.
- **Data**: La Plaza's equipment register (to be entered after launch); Arabic terms and catalogue price ranges.
- **Legal**: confirmation of the Law 182 thresholds and day counts.
- **Next package** from the backlog.
