# Hospital PAMS

Hospital procurement, BOQ planning and medical equipment management in one web app, built for Egyptian public
hospitals (Law 182 of 2018 on public contracting).

- **Plan:** build a bill of quantities (BOQ) from each department's beds and rooms, using editable equipment-ratio
  standards. Every quantity shows how it was worked out.
- **Buy:** run a tender from start to finish: specifications, RFQs, supplier offers with line-by-line compliance,
  technical and financial comparison, committees, award, purchase orders, goods receipt and invoices.
- **Run:** every device received becomes a tagged asset placed in its room. It then has planned maintenance, work
  orders, calibration, safety and radiation records, contracts, spare parts, loans, and in the end disposal.

One device classification runs through all of it, so a line goes from BOQ → specification → offer → purchase order
→ delivered asset → room on the floor map and in 3D. The BOQ's "plan vs installed" view closes the loop.

**Contents:** [Try it](#try-it) · [Roles](#roles-and-who-sees-what) · [The menu](#the-menu) ·
[What it does](#what-it-does) · [Rules it enforces](#rules-the-system-enforces) · [Security](#security) ·
[Running it for real](#running-it-for-real) · [How it's built](#how-its-built) ·
[Working on the code](#working-on-the-code) · [Documents](#documents) · [Status](#status-and-whats-left)

---

## Try it

You need Node.js 22 or newer ([nodejs.org](https://nodejs.org), or `brew install node` on a Mac). Nothing else.

On a Mac, double-click **Start demo.command**. Or in a terminal:

```bash
npm install
npm run demo          # the first start builds the app: 2–5 minutes; then open http://localhost:3000
```

Sign in with a demo account shown on the sign-in page (password `demo1234`). There is one account per role, so you
can see what each person sees. Examples: `admin@demo.hpams`, `procurement@demo.hpams`, `finance@demo.hpams`,
`viewer@demo.hpams`, `icu@demo.hpams` (a department head).

The demo keeps its data in an embedded database (PGlite: PostgreSQL running inside Node) in the `.pglite` folder.
Stop with Ctrl+C. Starting again keeps your changes and takes seconds; delete `.pglite` to start over. After a
`git pull`, the next start rebuilds the app and applies any database changes on its own.

**For real use on one laptop:** double-click **Start Hospital PAMS.command** (or `npm run local`). It starts empty
apart from the device catalogue, BOQ standards and default approval rules. It asks you to create the first
administrator and keeps the data in `.pglite-data`. For a team, run it on a server: see
[Running it for real](#running-it-for-real).

---

## Roles and who sees what

Everyone signs in. A role decides what a person can change. Users can be limited to some hospitals (facilities).
The permission matrix is one file, `src/lib/auth/permissions.ts`.

| Role | Can change |
|---|---|
| Administrator | Everything, plus users, settings, approval rules, notifications, imports, API tokens, backups |
| Director (competent authority) | Approves awards, high-value purchase orders, BOQs, disposals and the equipment plan; decides equipment requests |
| Procurement officer | Projects and tenders, specs, RFQs, suppliers, offers, award recommendations, POs, receiving, service contracts, invoices |
| Finance | Budgets, exchange rates, invoices (approve, record payment, delay penalties and waivers) |
| BOQ planner | BOQs, BOQ standards, room kits, the national guideline import; can request equipment |
| Biomedical engineer | Assets, maintenance, work orders, spare parts, recalls, calibration, radiation safety, imaging QC, competency, utilities and water, service contracts, disposals, facilities and rooms, the catalogue; can request equipment |
| Technician | My jobs (also offline on the phone), moving assets, maintenance records, booking parts |
| Department head | Read only for their departments, plus requesting equipment and approving requests (`requests.create`, `requests.approve`; the director still decides), signing acceptances for their own department, reporting a fault |
| Viewer | Read only, plus reporting a fault |

**Supplier prices are confidential.** Offers, prices, order values, budgets, framework agreements, invoices, the
spend reports and the Cost, Procurement and Budget analytics are only for Administrator, Director, Procurement and
Finance (`prices.view`). Everyone else sees tenders and orders (items, quantities, dates, status) with "Hidden" in
place of the money.

**Anyone signed in can report a fault**, from the device's page or by scanning its QR label.

**Separation of duties:** whoever submits something for approval can't decide it. An invoice needs three people: one
records it, another approves it, a third records the payment.

---

## The menu

The menu has nine hubs. The side menu shows one hub at a time with its main pages. Each hub also has its own page
(`/modules/plan`, `/modules/maintain` …) listing every page of the hub with one line about it: open it from
**All … pages** at the foot of the menu, the hub's name in the path bar, or Dashboard › All modules.

| Hub | Main pages |
|---|---|
| **Plan** | BOQs, quick start, standards and ratios, room kits, capital plan, replacement plan, commissioning |
| **Buy** | Projects and tenders, RFQs, offers, purchase orders, suppliers, supplier documents |
| **Pay** | Budgets, invoices, framework agreements, maintenance budget, exchange rates |
| **Equipment** | Asset register, my department, scan a label, catalogue, imports and labels, requests, rounds, loans, disposals, fleet, imaging use |
| **Maintain** | Work orders, My jobs, on call, planned maintenance, calibration, risk and strategy, equipment plan, critical backups, service contracts, public holidays, spare parts |
| **Safety & compliance** | Incidents, recalls, safety tests, radiation safety, imaging QC, MRI cryogen log, device security, user training, technician competency |
| **Buildings & 3D** | Facilities and floors, room standards, 3D view, floor map, utilities, water quality, patient pathways |
| **Reports** | Reports, executive summary, data quality, GAHAR evidence, Analytics |
| **Setup** | Users, approval rules and settings, notifications and escalation, documents, data imports, backups, audit log, system errors, API tokens |

Above every hub: Dashboard, All modules, Approvals and the Assistant. **Ctrl+K** (⌘K on a Mac) finds every page,
in the menu or not. **Help** (the **?** in the top bar, `/help`) has twelve short task guides with numbered steps that
link into the app; each person sees only the guides their role can follow. The hubs are defined in
`src/lib/modules.ts`, and a test checks that every page can be reached.

---

## What it does

### Plan: BOQs (`/boq`)

- **Quick start:** answer planning questions (beds, theatres, imaging rooms, throughput), or start from a hospital
  template, and get a full BOQ by department.
- **Standards and ratios:** equipment per bed, per room, per department or per hospital, with conditional rules,
  workload (throughput) rules and companion items. Each rule is sourced and editable (`docs/boq-standards.md`).
- **National Medical Equipment Guideline** (GAHAR): import it from a template at `/boq/standards/guideline`. BOQ ›
  Checks then shows what is missing, lower or higher than the guideline.
- **Every quantity explained:** the BOQ shows the rule and the numbers behind each line. Hand-typed changes survive
  regeneration.
- **Checks:** fit to budget, benchmarks, risks, room requirements and room standards, cost of ownership, phasing.
- **Room kits:** standard equipment sets per room type.
- **Start a tender from a BOQ** (`/boq/[id]/tender`): pick lines or device types and make a draft RFQ (with draft
  specs if wanted). The **Tender & orders** tab shows plan vs ordered per device type.
- **Excel export**, versions, approval, and "plan vs installed" once equipment arrives.

### Buy: procurement and tenders (`/procurement`)

- **Projects and tenders:** the procurement method (public, limited, local or two-stage tender, public or limited
  practice, direct agreement, framework call-off), with the reason for anything but a public tender, and an
  **Urgent** flag with a reason. A **timetable** of planned and actual dates for each step: the app fills in the
  dates it already knows, checks the legal minimum periods and alerts when a step is overdue.
- **Technical specifications** built from the catalogue's spec templates.
- **RFQs** raised from a BOQ (items and quantities frozen when the RFQ is created), with invited suppliers.
- **Clarifications and addenda:** bidder questions and answers, and numbered addenda that can move the closing date.
  A printable "notice to all bidders" never names who asked.
- **Offers:** line by line, with compliance against every spec item. Bids can be imported from an Excel template
  that the app generates per supplier and checks before saving.
- **Two-envelope tenders:** prices stay sealed on every page until the financial envelopes are opened.
- **Comparison:**
  - weighted technical and financial scores
  - several lines of one item added together
  - partial bids marked "not ranked"
  - the lowest single award priced at the required quantities
  - landed cost by Incoterm (freight, insurance, duty, clearance, local delivery)
  - cost of ownership
  - prices converted at the tender's price-opening date
  - a badge on offers well above earlier prices for the same device type
  - downloadable as Excel
- **Committees (Law 182):** envelope-opening and adjudication committees, with a Ministry of Finance member and a
  State Council member required above the value thresholds. Minutes are generated with each member's Arabic legal
  name.
- **Award:** a recommendation goes to the competent authority, and only one offer per tender can hold the award.
  The complaint window and acceptance dates follow. The app prints the **award and regret letters**.
- **Purchase orders:** from the awarded offer (adding up to the offer total to the cent) or from a framework
  call-off within its limits. Approval chains by value, then issue and print.
- **Goods receipt:** each unit received becomes a tagged asset, linked to its PO line, supplier, cost and warranty.
- **Suppliers:** contacts, documents with expiry dates, ratings, and their Arabic legal name for letters.

### Pay: money (`/procurement/budgets`, `/procurement/invoices`, `/procurement/exchange-rates`)

- **Budgets** by budget year (July–June by default: "FY 2026/27"), showing committed and spent. Paid invoices still
  count as spent if their PO is cancelled, and a PO closed short releases what wasn't delivered.
- **Exchange rates:** Finance records the Central Bank rate of each currency by date. Offers convert at their
  opening date, orders at their order date and purchases at their purchase date. Rates older than a month are
  flagged. Money with no currency shows in EGP.
- **Invoices** with a three-way match (order, delivery, invoice), approval, payment, and the **late-delivery
  penalty** under Law 182 (see [Rules](#rules-the-system-enforces)), with a waiver that needs a reason. There's a CSV
  export for finance.
- **Framework agreements:** agreed prices and limits; call-offs are checked against the item maximum and the ceiling.
- **Maintenance budget:** maintenance spending against its budget.

### Equipment: the register (`/assets`)

- **Asset register:** 50 rows a page, sorted and counted in the database, with a column chooser. Filter by
  hospital, department, room, type, status or PO, and print QR labels for the selected devices. Each device page
  shows its whole history.
- **Scan a label** with the phone camera on any phone (Chrome on Android, and iPhone Safari or Firefox through
  jsQR), a hand scanner, or by typing the tag. Scanning a GS1/UDI label into the UDI field fills the serial number.
- **Equipment ID card** on the device page: the vendor's emergency line, the running contract and the in-house
  contact; "Print ID card" (A5 with QR).
- **Imports:** assets from Excel (`/assets/import`), bulk placement into rooms, A4 label sheets.
- **Equipment requests** from departments, **rounds and stock-take**, **loans and rentals**, **disposals** (with
  approval), **fleet and standardisation**, **imaging use** with exam counts imported from the RIS/PACS.

### Maintain (`/assets/work-orders`, `/assets/maintenance`)

- **Work orders:** report a fault, assign, work, complete and close. Downtime is recorded, with overlapping jobs
  counted once. A corrective job needs a **failure code** (14 standard codes) to complete.
- **Fault-report escalation:** a fault nobody picks up within its target (life support or urgent 30 min, high 2 h,
  normal 1 working day, low 2 working days; editable) tells the on-call team again, then the biomedical lead. On-call
  list under Work orders › On call.
- **My jobs** (`/assets/my-jobs`, the technician's start page): open jobs and PPM assigned to you, with large
  buttons and **Scan a device**. **It works offline:** open it once with signal; after that notes, labour, parts,
  checklist results and completing a job are queued on the phone and sent when back online. A clash with someone
  else's change is shown, and the technician chooses **Send mine anyway** or **Drop mine**.
- **Planned maintenance (PPM):** schedules by type or by usage, checklists, compliance, risk-based strategy and the
  maintenance budget. **Strategy guard:** no hospital schedule or run to failure for imaging/radiation, MRI and
  medical lasers, or for types with too little history; the hospital's own schedule needs an evidence and risk basis.
- **Technician competency** (GAHAR EFS.10): who is trained and authorised on which device type. Assigning someone
  not authorised warns and records an override.
- **Calibration** of clinical devices: interval by type or device, certificates, due and failed lists, compliance.
  A device that fails calibration stays out of service until it passes.
- **Service contracts:** response and repair times and uptime guarantees counted in **covered hours** (for example
  Sun–Thu 08:00–20:00, not on public holidays), with penalties. Monthly statements and the supplier scorecard use
  covered hours.
- **Equipment management plan** (`/assets/equipment-plan`, GAHAR): per hospital and year, with KPIs and targets,
  approved through Approvals, with a yearly review.
- **Critical backups** (`/assets/critical-backup`): units in use and backups per department and device type, a
  shortfall list, and an alert when the last working backup goes.
- **Spare parts:** stock that never goes below zero, booked to jobs, with reorder alerts.
- **Replacement plan** (score by age, downtime, cost, support and out-of-support software) and the **capital plan**
  by budget year with book values (both under Plan), and commissioning and acceptance of new equipment.

### Safety & compliance

- **Incidents** with **EDA vigilance** (GL.CAP.Care.040): safety contact officer and radiation protection officer per
  hospital; a device kept as found blocks repair and disposal until released; the incident prints in the EDA Annex 2
  layout.
- **Recalls:** source (FDA, MHRA, EDA, maker notice), department acknowledgements, and an openFDA file import (JSON
  or CSV, no live fetch) matched to devices by maker and model, to confirm or dismiss. Bulk "dealt with" or "not
  affected".
- **Safety tests** (IEC 62353): limits by test path, mobile X-ray and defibrillator limits, and a passed test at
  acceptance and after a repair (or a reason).
- **Radiation safety** (`/assets/radiation`), per hospital: ENRRA licences, physicist QC tests, staff dosimetry (eye
  lens, extremity, five-year and single-year checks; a declared pregnancy seen only by the radiation protection
  officer and administrators), protective equipment checks, and a status for each room.
- **Imaging QC** (`/assets/imaging-qc`, GAHAR DAS.05): technologist checks per modality and frequency, with pass/fail
  or measured items with limits (example templates, marked as examples), a due list, a failed run → work order in
  one click, and a monthly review sign-off.
- **MRI cryogen log:** helium, pressure, cold head and compressor readings, with alerts. **X-ray and CT tubes:**
  counters, expected life and a forecast replacement date.
- **Device security** (IEC 80001-1, MDS2): the SBOM and software components with support end dates per model, a
  network risk per connection (5 × 5 matrix), and the supplier's remote-access agreement with its expiry.
- **User training**: trained users per device type and refreshers due.

### Buildings & 3D (`/facilities`, `/assets/map`, `/assets/3d`, `/buildings`, `/flows`)

- **Facilities:** buildings, floors, departments and rooms, imported from CAD drawings (DWG → building file;
  `tools/cad`) or drawn by hand. **Floor map:** devices pinned in their rooms.
- **3D view** of the whole building:
  - layers for problems, downtime, PPM and warranty
  - furniture and equipment models
  - saved views
  - the nearest working device, with a walking route
  - a history replay of device status, day by day
  - walk mode
  - photo-style floor renders and a printable floor book
  - presets for Imaging and ICU
- **Utilities** (`/buildings/utilities`, GAHAR EFS.11): generators, UPS, transfer switches, medical gas alarms,
  cold chain, tanks, air handling and more are devices in the register, with scheduled tests and results. A failed
  test opens a work order; overdue tests on critical systems alert.
- **Water quality** (`/buildings/water`, GAHAR EFS.12): sampling points for dialysis, sterilizer feed water and
  drinking water, with editable limits. Over the limit opens a work order and alerts biomedical.
- **Room standards, patient pathways, analysis and a queue simulation** for planning patient and equipment flows.

### Reports and Analytics (`/reports`, `/analytics`)

- **Reports:** register, maintenance, compliance, calibration, electrical safety, recalls, user training, book value,
  purchase orders, spend, service cost and others. Each exports to Excel. There's also an **executive summary**.
- **GAHAR evidence pack** (`/reports/gahar`): per hospital and period, one section per standard (EFS.10, EFS.11,
  EFS.12, DAS.05, DAS.09); each item marked have, partly or missing, with a link to the records. Worded "GAHAR 2025
  standards"; check the current handbook.
- **Data quality** (`/reports/data-quality`): 16 rules (missing serial, cost or room, duplicate serials, jobs open
  90+ days, orders with no invoice …), each with a count and the records to fix, and a score per hospital.
- **Analytics**, nine tabs with one filter bar (hospital, department, device type, dates). Each figure shows its
  formula, period, count and benchmark with source; fewer than 5 items says "Not enough data".
  - **Overview:** uptime, PPM on time, open jobs, COSR, data-quality score
  - **Maintenance:** uptime over the period, MTBF, MTTR, repeat failures, failure codes, PPM yield
  - **Lifecycle:** replacements per budget year over ten years, and a capital what-if saved per hospital
  - **Imaging:** exams by weekday and month, idle capacity, exams per scanner against benchmarks
  - **Cost** (prices): spend by supplier, category, department and year; COSR by device type
  - **Budget** (prices): budget, committed, spent and a year-end forecast per budget line
  - **Procurement** (prices): bids per RFQ, single-bid share, days to award, prices paid, supplier scorecard
  - **Compare:** hospitals side by side
  - **Export:** one Excel file of the figures
- **Power BI:** read-only `bi_` views (`docs/bi-views.sql`) and a read-only database role `pams_bi`
  (`docs/deploy.md`). BI access shows prices.

### Across the app

- **Approvals** (`/approvals`): one inbox for POs, BOQs, awards, disposals and the equipment plan, with rules by
  value and type, paper signatures recorded when needed, and a repair pass that re-applies an approval whose effect
  was lost.
  - **Deputy (out of office):** name a deputy for a date range; they are recorded as "approved by X for Y".
    Committee signatures are not delegated.
  - **Escalation:** a step waiting N working days (default 3; Friday and Saturday off) reminds the approver; at twice
    that the director is told. The page shows "waiting since", "Reminded" and "Escalated".
- **Notifications:** an hourly run covers warranty, PPM, calibration and safety tests due, licences, contracts,
  stock, recalls, loans, tender steps overdue, budget use, utilities and water tests, critical backups, backups and
  more. Each person chooses in app, email, both or off per kind (Your account › Notifications), or a **daily
  digest** email; administrators set the defaults per role. Safety notices always stay in the inbox and are emailed
  at once. An optional webhook sends safety notices to an SMS or WhatsApp gateway.
- **Lists:** paged (50 rows), sorted in the database, with sticky headers and a column picker. **Saved filters** are
  kept on the server, open on any computer and can be shared with your role.
- **Bulk actions** on ticked rows, each row checked and logged: users (switch on/off, set role), assets (move, set
  criticality, schedule PPM), work orders (assign, priority, cancel as duplicates), PPM (move date, assign), recall
  devices, documents.
- **Documents:** versions with who uploaded each and a note; removing hides a document and keeps its files;
  Administration › Documents lists all, with Restore and Delete for good.
- **Data imports** (`/admin/imports`): suppliers, service contracts, users (no passwords), PPM schedules and spare
  parts, from Excel or CSV, with a template and a check report before anything is written.
- **Read-only API** (`/api/v1/assets`, `/work-orders`, `/ppm`, `/analytics/kpis`): tokens made at `/admin/api`
  with scopes, hospitals and expiry; no money without `prices:read`; 60 calls a minute; every call logged. See
  [docs/api.md](docs/api.md).
- **Search** across devices, rooms, suppliers, POs and tenders. **Assistant:** answers questions from the app's data.
  It needs an Anthropic API key and is limited per person per hour.
- **Dark mode:** in the user menu under Look, with Light, Dark or Same as my device. Letters and labels always print
  light.
- **Administration:** users and roles, approval rules and settings (thresholds, delay penalties, legal minimum
  days, landed-cost defaults, budget year start, labour cost per hour, sign-in rules), the audit log, system errors,
  and backups.

The English interface is the rule. Arabic appears only in formal documents: letters, minutes and the PO print carry
the Arabic legal names of the hospital, suppliers, committee members and devices.

---

## Rules the system enforces

- **BOQ:**
  - Hand-typed quantities and prices survive regeneration.
  - An approved BOQ is locked; make a new version to change it.
  - A BOQ used for an RFQ can't be deleted.
- **Tenders:**
  - An RFQ freezes its items when created.
  - A line failing a mandatory spec item is non-responsive.
  - Rejecting an offer needs a reason, and awarding a non-compliant offer needs a written justification.
  - Prices are sealed until the financial opening in two-envelope tenders.
  - An awarded offer is locked, and an award can't be revoked while a live PO depends on it.
  - There is one award per tender.
  - **Law 182 legal minimum days** to the envelope opening: public tender 20 (urgent 14), limited and local tender
    14 (10), two-stage 20, public practice 20 (14), limited practice 14 (10). Suggested dates never go below them.
  - **Bid bond** is up to 1.5 % of the estimated value (not of each offer).
- **Money:**
  - An invoice can only hold lines of its own PO.
  - You can't order, receive or invoice more than allowed. These checks are safe when two people act at once.
  - Amounts with no exchange rate are listed, never counted as 0.
  - **Delay penalty (Law 182 art. 48):** supply and services in steps by the delay as a share of the delivery period
    (up to 3 % → 1 %, 6 % → 2 %, 10 % → 3 %, more → 5 %; cap 5 %); works 1 % a week, cap 10 % (15 % for long
    delays). On the late items, or the whole order when the late part prevents use. A waiver needs a reason.
  - The Law 182 figures are in Settings and should be **checked against the official Gazette** before go-live.
- **Assets:**
  - Each serial number exists once.
  - Assets, rooms and departments link only within one hospital.
  - Every move is recorded.
  - A condemned device, or one that failed calibration, can't be put back in service by closing a job.
- **Work orders:** each step is allowed only from the right status and role. A device with open jobs, or one kept as
  found for an incident, can't be disposed. A corrective job needs a failure code.
- **Maintenance strategy:** no hospital schedule or run to failure for imaging/radiation, MRI and lasers, or without
  enough history.
- **Every server action** checks a permission first; a test enforces it.
- **Database checks** refuse negative money, zero quantities, receiving more than was ordered, and negative stock.

## Security

- **Passwords and two-step sign-in:**
  - Passwords are hashed.
  - Two-step sign-in (codes from a phone app) can be required by role; the wrong-code limit carries over between
    sign-ins.
  - Two-step secrets are stored encrypted when `APP_SECRET` is set.
- **Microsoft and Google sign-in** (through Supabase): optional. It also requires the two-step code, needs a
  verified email, and is linked to the person's own account at the first sign-in.
- **Attacks and leaks:**
  - Sign-in attempts are throttled per account and per address.
  - Security headers include a strict content security policy.
  - CSV exports are safe to open in Excel.
  - File paths are checked.
  - The assistant treats pasted text as data.
- **Audit log** of who did what; IP addresses come from the proxy, not from the browser.
- **API tokens** are kept only as a SHA-256 hash, shown once, limited by scope, hospital and expiry.
- **System errors** are saved (90 days) with passwords in connection strings masked; the stack is for
  administrators only.
- **Backups** are readable by the app only, and the first-administrator setup needs `SETUP_CODE` on a server.

---

## Running it for real

### One server with Docker (recommended)

```bash
cp .env.example .env      # set DOMAIN, POSTGRES_PASSWORD, SETUP_CODE, APP_SECRET (and SMTP for email)
docker compose up -d --build
```

This runs the app, PostgreSQL 16, Caddy (automatic HTTPS for your domain) and a nightly backup job. On first visit
the app asks for `SETUP_CODE` and creates the first administrator. Full steps, Supabase, and going live:
[docs/deploy.md](docs/deploy.md).

**Main settings** (`.env`; every option is listed in `.env.example`):

| Setting | What it does |
|---|---|
| `DOMAIN`, `APP_URL` | The site's address (labels and emails link to it) |
| `POSTGRES_PASSWORD` or `DATABASE_URL` | The database |
| `SETUP_CODE` | Asked for when creating the first administrator |
| `APP_SECRET` | 32+ random characters; encrypts two-step secrets. Keep a copy with the backups and never change it |
| `SMTP_URL`, `MAIL_FROM` | Email for notifications |
| `TRUST_PROXY`, `COOKIE_SECURE` | Set behind the Caddy proxy (done in docker-compose) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PROVIDERS`, `SUPABASE_AZURE_TENANTS` | Microsoft/Google sign-in |
| `NOTIFY_WEBHOOK_URL`, `NOTIFY_WEBHOOK_TOKEN` | Optional SMS / WhatsApp gateway for safety notices |
| `ANTHROPIC_API_KEY` | The assistant |
| `BACKUP_KEEP_DAYS`, `MIGRATE_BACKUP` | How long backups are kept; the safety copy before database changes |
| `BACKUP_REMOTE_KIND`, `BACKUP_REMOTE_URL` (+ `_REGION`, `_ACCESS_KEY`, `_SECRET_KEY` or `_SSH_KEY`) | Off-site copy of each backup to S3-compatible storage or over rsync/ssh |
| `NEXT_PUBLIC_APP_TIME_ZONE` | Defaults to Africa/Cairo |

**Backups:** every night the job writes a verified database dump and an archive of uploaded files to `./backups`,
keeping 14 days, and removes old copies only after a good run. Administration › Backups shows them, makes one now,
runs a restore check, and alerts administrators when the nightly backup fails or is over two days old. With
`BACKUP_REMOTE_*` set, each good backup is also copied off site; the page shows the last copy and a failed copy
alerts administrators.

**Health check:** `GET /api/health` (no sign-in) answers `{ ok, db, version, time }`, or 503 when the database is
down. Docker's health check uses it. Server errors are listed under Administration › System errors.

**Updating:** `git pull`, then `docker compose up -d --build`. Database changes apply on start, under a lock and
after a safety copy. Reference data (catalogue, standards) is only ever added on start, so your edits survive.

### Without Docker

Point `DATABASE_URL` at PostgreSQL 15 or newer (or Supabase), then:

```bash
npm ci && npm run build
npm run db:migrate && npx tsx scripts/seed.ts --only=none   # database and reference data
npm start
```

---

## How it's built

| Part | Technology |
|---|---|
| App | Next.js 16 (App Router, server components and server actions), React 19, TypeScript (strict) |
| Look | Tailwind CSS v4 with colour tokens (light and dark), the app's own components (`src/components/ui`) |
| Database | PostgreSQL 16 via Drizzle ORM; PGlite for the laptop and demo |
| 3D | three.js |
| Files | exceljs (Excel), qrcode (labels), nodemailer (email) |
| Tests | Vitest (unit and database tests on PGlite), Playwright (page check) |

### Where the code lives

| Path | What |
|---|---|
| `src/db/schema.ts` (+ `schema-wave37-*.ts` … `schema-wave41-*.ts`) | The data model. Migrations in `drizzle/` (up to `0053`) |
| `src/lib/modules.ts` | The nine hubs: menu, hub pages, path bar and Ctrl+K |
| `src/app/boq`, `src/lib/boq` | BOQ engine, builder, standards, checks, Excel export |
| `src/app/procurement`, `src/lib/procurement` | Tenders, timetable, RFQs, offers, comparison, letters, POs, receiving, invoices, budgets |
| `src/app/assets`, `src/lib/assets` | Register, maintenance, work orders, contracts, calibration, radiation, imaging, parts, lifecycle |
| `src/components/assets/twin` | The 3D view |
| `src/app/facilities`, `tools/cad`, `seed-data/cad` | Buildings, floors and rooms; the DWG import pipeline |
| `src/lib/auth` | Sign-in, two-step, roles and permissions, who sees prices |
| `src/lib/notifications`, `src/lib/approvals` | Notifications, digests, the hourly alert run; deputies and escalation |
| `src/lib/reports`, `src/lib/analytics`, `src/lib/compliance` | Reports and Excel exports; Analytics; the GAHAR evidence map |
| `src/lib/utilities` | Utility tests and water limits |
| `src/app/api` | `/api/health` and the read-only API `/api/v1` |
| `src/lib/imports`, `src/lib/bulk.ts`, `src/lib/paging.ts`, `src/lib/help.ts` | Imports, bulk actions, paged lists, help guides |
| `public/sw.js`, `src/lib/assets/offline-jobs.ts` | Offline My jobs |
| `src/lib/fx.ts`, `src/lib/fiscal-year.ts`, `src/lib/format.ts` | Exchange rates by date, budget years, Cairo dates and money formatting |
| `seed-data/` | Device taxonomy, BOQ standards, department types, quick-start rules |
| `scripts/` | Launcher, migrate, seed (reference and demo data), backups, page check |

---

## Working on the code

Read [AGENTS.md](AGENTS.md) (strict conventions) and [docs/HANDOVER.md](docs/HANDOVER.md) first.

- **How we work:** each piece of work goes on a branch (`wave-N`). Merge into `main` only after Hisham's OK.
- **Before each commit:**

  ```bash
  npx tsc --noEmit -p .        # typecheck
  npx eslint src scripts       # lint
  npx vitest run               # about 1,400 tests, including database tests on PGlite
  npm run demo                 # then, with the demo running:
  npm run check:pages          # opens every kind of page as admin, a viewer and a department head
  ```

- **Database changes:** edit the schema, then `npm run db:generate` (creates a migration in `drizzle/`). Migrations
  run on start.
- **Demo data:** `scripts/seed/*.ts`. Every seed can run more than once without adding anything twice.
- **CI** (`.github/workflows`): runs typecheck, lint and tests; migrates and seeds PostgreSQL 16; builds the Docker
  image.
- **Interface rules:**
  - plain, short English, in sentence case
  - colours only through tokens
  - money with `formatMoney`
  - dates in Cairo time with `todayISO`
  - destructive actions ask first, in the shared dialog
  - lists use `DataTable` and paging (`src/lib/paging.ts`)
  - a new page goes in one hub's section in `src/lib/modules.ts`

## Documents

| Document | For |
|---|---|
| [docs/user-guide.md](docs/user-guide.md) | Everyday jobs, by role |
| [docs/deploy.md](docs/deploy.md) | Servers, Docker, Supabase, backups and off-site copies, Power BI, going live |
| [docs/api.md](docs/api.md) | The read-only API |
| [docs/bi-views.sql](docs/bi-views.sql) | Read-only views for Power BI |
| [docs/HANDOVER.md](docs/HANDOVER.md) | The current state and what's left (the working list) |
| [docs/system-documentation.md](docs/system-documentation.md) | In-depth description at release 3.0 (older; this file and the handover are current) |
| [docs/boq-standards.md](docs/boq-standards.md), [docs/taxonomy.md](docs/taxonomy.md) | BOQ standards and the device classification, with sources |
| [docs/reference-figures.md](docs/reference-figures.md) | Planning reference figures awaiting review |
| [CHANGELOG.md](CHANGELOG.md) | What each wave added |
| [AGENTS.md](AGENTS.md) | Engineering conventions |

## Status and what's left

Waves 1–38 are in `main`. **Waves 39–42 are on branch `wave-42`, waiting for Hisham's OK to merge:** Law 182 rules,
data quality, offline My jobs and phone scanning (39); GAHAR readiness and Analytics (40); notifications, delegation
and escalation, utilities and water, cyber, API, imports, paged lists, bulk actions, help and saved filters (41); the
nine-hub menu (42). What's left needs input from the hospital or a partner, not more building:

| Item | Needs |
|---|---|
| Go-live | The server and domain, the hospital mail server, the user list with roles; a Docker build and a load test there |
| Real data | La Plaza's equipment register; makers' site figures; the reviewed reference figures |
| Figures to confirm | Law 182 figures against the official Gazette; landed-cost defaults; radiation dose limits and QC intervals; MRI helium limits; the example imaging QC limits (a physicist); the ISO 23500 edition and sterilizer feed water limits |
| Lists to supply | Egypt's public holidays (for working-day counts); the national guideline file from GAHAR |
| Microsoft/Google sign-in | A Supabase project; not yet tried with real accounts |
| Assistant | An Anthropic API key; try real questions |
| Integrations | The ERP and e-procurement file formats; UPA MediQ formats; links to the HIS and RIS (exam counts are imported from files for now) |
| Pilots with partners | Building services (MEP) layers, BIM/IFC import, real-time location |

The working list is section 7 of [docs/HANDOVER.md](docs/HANDOVER.md). An Arabic right-to-left interface would be
built only if the rule changes.
