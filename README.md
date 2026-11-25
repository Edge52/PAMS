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

**Contents:** [Try it](#try-it) · [Roles](#roles-and-who-sees-what) · [What it does](#what-it-does) ·
[Rules it enforces](#rules-the-system-enforces) · [Security](#security) · [Running it for real](#running-it-for-real) ·
[How it's built](#how-its-built) · [Working on the code](#working-on-the-code) · [Documents](#documents) ·
[Status](#status-and-whats-left)

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

| Role | Can change |
|---|---|
| Administrator | Everything, plus users, settings, approval rules, backups |
| Director (competent authority) | Approves awards, high-value purchase orders, BOQs and disposals |
| Procurement officer | Projects and tenders, specs, RFQs, suppliers, offers, award recommendations, POs, receiving, service contracts, invoices |
| Finance | Budgets, exchange rates, invoices (approve, record payment, delay penalties) |
| BOQ planner | BOQs, BOQ standards, room kits |
| Biomedical engineer | Assets, maintenance, work orders, spare parts, recalls, calibration, radiation safety, service contracts, disposals, facilities and rooms, the catalogue |
| Technician | Moving assets, maintenance records, working on assigned jobs, booking parts |
| Department head, Viewer | Read only, plus reporting a fault |

**Supplier prices are confidential.** Offers, prices, order values, budgets, framework agreements, invoices and the
spend reports are only for Administrator, Director, Procurement and Finance. Everyone else sees tenders and orders
(items, quantities, dates, status) with "Hidden" in place of the money.

**Anyone signed in can report a fault**, from the device's page or by scanning its QR label.

**Separation of duties:** whoever submits something for approval can't decide it. An invoice needs three people: one
records it, another approves it, a third records the payment.

---

## What it does

The menu is grouped into modules (Dashboard › All modules). The main pages are listed below.

### Planning: BOQs (`/boq`)

- **Quick start:** answer planning questions (beds, theatres, imaging rooms, throughput), or start from a hospital
  template, and get a full BOQ by department.
- **Standards and ratios:** equipment per bed, per room, per department or per hospital, with conditional rules,
  workload (throughput) rules and companion items. Each rule is sourced and editable (`docs/boq-standards.md`).
- **Every quantity explained:** the BOQ shows the rule and the numbers behind each line. Hand-typed changes survive
  regeneration.
- **Checks:** fit to budget, benchmarks, risks, room requirements and room standards, cost of ownership, phasing.
- **Room kits:** standard equipment sets per room type.
- **Excel export**, versions, approval, and "plan vs installed" once equipment arrives.

### Procurement and tenders (`/procurement`)

- **Projects and tenders:** the procurement method (public, limited, local or two-stage tender, public or limited
  practice, direct agreement, framework call-off), with the reason for anything but a public tender. Also a
  **timetable** of planned and actual dates for each step. The app fills in the dates it already knows, checks the
  minimum periods and alerts when a step is overdue.
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
- **Framework agreements:** agreed prices and limits; call-offs are checked against the item maximum and the ceiling.

### Money (`/procurement/budgets`, `/procurement/invoices`, `/procurement/exchange-rates`)

- **Budgets** by budget year (July–June by default: "FY 2026/27"), showing committed and spent. Paid invoices still
  count as spent if their PO is cancelled, and a PO closed short releases what wasn't delivered.
- **Exchange rates:** Finance records the Central Bank rate of each currency by date. Offers convert at their
  opening date, orders at their order date and purchases at their purchase date. Rates older than a month are
  flagged.
- **Invoices** with a three-way match (order, delivery, invoice), approval, payment, and the **late-delivery penalty**
  (a weekly rate up to a cap, on the late items only). There's a CSV export for finance.

### Assets and maintenance (`/assets`)

- **Asset register:** sortable, with a column chooser. Filter by hospital, department, room, type, status or PO, and
  print QR labels for the selected devices. Each device page shows its whole history.
- **Scan a label:** the phone camera, a hand scanner, or typing the tag. Labels open the device by its tag.
- **Work orders:** report a fault, assign, work, complete and close. Downtime is recorded, with overlapping jobs
  counted once.
- **Planned maintenance (PPM):** schedules by type or by usage, checklists, compliance, risk-based strategy
  (run-to-failure types get no PPM), and the maintenance budget.
- **Service contracts:** response and repair times, uptime guarantees with **covered hours** (for example Sun–Thu
  08:00–20:00, not on public holidays) and penalties. Monthly statements are worked out in covered hours.
- **Calibration** of clinical devices: interval by type or device, certificates, due and failed lists, compliance.
  A device that fails calibration stays out of service until it passes.
- **Safety tests** (electrical safety), **recalls**, **incidents**, **device security**, **user training**.
- **Spare parts:** stock that never goes below zero, booked to jobs, with reorder alerts.
- **Loans and rentals**, **equipment requests**, **rounds and stock-take**, **disposals** (with approval).
- **Fleet and standardisation**, the **replacement plan** (score by age, downtime, cost and support), the **capital
  plan** by budget year with book values, and commissioning and acceptance of new equipment.

### Imaging and radiation safety

- **Imaging use:** exams per device. Daily exam counts can be imported from the RIS/PACS export (by device tag or AE
  title) and feed usage-based maintenance.
- **Radiation safety** (`/assets/radiation`), per hospital:
  - ENRRA licences per room or device
  - physicist QC tests
  - staff dosimetry readings against the dose limit
  - lead apron and other protective checks
  - a status for each room: in order, due soon or action needed
- **MRI cryogen log:** helium, pressure, cold head and compressor readings, with alerts when helium is low or falling
  fast, a reading is missing, or the cold head stops.
- **X-ray and CT tubes:** counter readings, warranty, expected life, a forecast replacement date and replacement
  history.

### Facilities, floor map and 3D (`/facilities`, `/assets/map`, `/assets/3d`)

- **Facilities:** buildings, floors, departments and rooms, imported from CAD drawings (DWG → building file;
  `tools/cad`) or drawn by hand.
- **Floor map:** devices pinned in their rooms.
- **3D view** of the whole building:
  - layers for problems, downtime, PPM and warranty
  - furniture and equipment models
  - saved views
  - the nearest working device, with a walking route
  - a history replay of device status, day by day
  - walk mode
  - photo-style floor renders and a printable floor book
  - presets for Imaging and ICU
- **Room standards, pathways, analysis and a porter simulation** for planning patient and equipment flows.

### Across the app

- **Approvals** (`/approvals`): one inbox for POs, BOQs, awards and disposals, with rules by value and type, paper
  signatures recorded when needed, and a repair pass that re-applies an approval whose effect was lost.
- **Notifications:** an hourly run covers warranty, PPM, calibration and safety tests due, licences expiring,
  contracts, stock, recalls, loans, tender steps overdue, budget use, backups and more. They arrive in the app, and by
  email if it's set up.
- **Reports** (`/reports`): register, maintenance, compliance, book value, purchase orders, spend, service cost, and
  others. Each exports to Excel. There's also an **executive summary**.
- **Search** across devices, rooms, suppliers, POs and tenders. **Assistant:** answers questions from the app's data.
  It needs an Anthropic API key and is limited per person per hour.
- **Dark mode:** in the user menu under Look, with Light, Dark or Same as my device. Letters and labels always print
  light.
- **Administration:** users and roles, approval rules and settings (thresholds, delay penalties, landed-cost defaults,
  tender minimum days, budget year start, sign-in rules), the audit log, and backups.

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
- **Money:**
  - An invoice can only hold lines of its own PO.
  - You can't order, receive or invoice more than allowed. These checks are safe when two people act at once.
  - Amounts with no exchange rate are listed, never counted as 0.
- **Assets:**
  - Each serial number exists once.
  - Assets, rooms and departments link only within one hospital.
  - Every move is recorded.
  - A condemned device, or one that failed calibration, can't be put back in service by closing a job.
- **Work orders:** each step is allowed only from the right status and role. A device with open jobs can't be
  disposed.
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
| `ANTHROPIC_API_KEY` | The assistant |
| `BACKUP_KEEP_DAYS`, `MIGRATE_BACKUP` | How long backups are kept; the safety copy before database changes |
| `NEXT_PUBLIC_APP_TIME_ZONE` | Defaults to Africa/Cairo |

**Backups:** every night the job writes a verified database dump and an archive of uploaded files to `./backups`,
keeping 14 days, and removes old copies only after a good run. Administration › Backups shows them, makes one now,
runs a restore check, and alerts administrators when the nightly backup fails or is over two days old.

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
| `src/db/schema.ts` (+ `schema-wave37-*.ts`, `schema-wave38-*.ts`) | The data model. Migrations in `drizzle/` |
| `src/app/boq`, `src/lib/boq` | BOQ engine, builder, standards, checks, Excel export |
| `src/app/procurement`, `src/lib/procurement` | Tenders, timetable, RFQs, offers, comparison, letters, POs, receiving, invoices, budgets |
| `src/app/assets`, `src/lib/assets` | Register, maintenance, work orders, contracts, calibration, radiation, imaging, parts, lifecycle |
| `src/components/assets/twin` | The 3D view |
| `src/app/facilities`, `tools/cad`, `seed-data/cad` | Buildings, floors and rooms; the DWG import pipeline |
| `src/lib/auth` | Sign-in, two-step, roles and permissions, who sees prices |
| `src/lib/notifications` | Notifications and the hourly alert run |
| `src/lib/reports` | Reports and their Excel exports |
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
  npx vitest run               # about 1,100 tests, including database tests on PGlite
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
  - new lists use `DataTable`

## Documents

| Document | For |
|---|---|
| [docs/user-guide.md](docs/user-guide.md) | Everyday jobs, by role |
| [docs/deploy.md](docs/deploy.md) | Servers, Docker, Supabase, backups, going live |
| [docs/HANDOVER.md](docs/HANDOVER.md) | The current state and what's left (the working list) |
| [docs/system-documentation.md](docs/system-documentation.md) | In-depth description at release 3.0 |
| [docs/boq-standards.md](docs/boq-standards.md), [docs/taxonomy.md](docs/taxonomy.md) | BOQ standards and the device classification, with sources |
| [docs/reference-figures.md](docs/reference-figures.md) | Planning reference figures awaiting review |
| [CHANGELOG.md](CHANGELOG.md) | What each wave added |
| [AGENTS.md](AGENTS.md) | Engineering conventions |

## Status and what's left

All 38 waves are in `main`, including every fix and missing feature from the wave 30 audit (waves 32–38).
What's left needs input from the hospital or a partner, not more building:

| Item | Needs |
|---|---|
| Go-live | The server and domain, the hospital mail server, the user list with roles; a Docker build and a load test there |
| Real data | La Plaza's equipment register; makers' site figures; the reviewed reference figures |
| Figures to confirm | Law 182 minimum tender periods; delay penalty and landed-cost defaults; radiation dose limits and QC intervals; MRI helium limits |
| Microsoft/Google sign-in | A Supabase project; not yet tried with real accounts |
| Assistant | An Anthropic API key; try real questions |
| Integrations | The ERP and e-procurement file formats; links to the HIS and RIS (exam counts are imported from files for now) |
| Pilots with partners | Building services (MEP) layers, BIM/IFC import, real-time location |

Smaller items that could still be built: an Arabic right-to-left interface (only if the rule changes), camera
scanning on every phone (needs a QR library), "deactivate selected" on the users list, contract response and
repair times in covered hours, and moving the remaining lists to the shared sortable table.
