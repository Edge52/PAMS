# Hospital PAMS

Hospital procurement, BOQ planning and medical asset management in one system.

- **Plan** — build a bill of quantities from department scope (beds, rooms) using editable equipment-ratio standards, with every quantity explained.
- **Procure** — run a tender end to end: technical specifications, RFQs, supplier offers with line-by-line compliance, weighted technical/financial comparison, award, purchase orders and goods receipt.
- **Track** — every device received becomes an asset with a tag, located by facility › building › floor › department › room and pinned on the floor map, with warranty, planned maintenance, movements and its full procurement trail.

The modules share one device classification, so a line flows from BOQ → specification → offer → purchase order → delivered asset → room on the map, and the BOQ's "plan vs installed" view closes the loop.

## Try it on a laptop

Requirements: Node.js 22 or newer ([nodejs.org](https://nodejs.org), or `brew install node` on a Mac). Nothing else.

On a Mac, double-click **Start demo.command**. Or in a terminal:

```bash
npm install
npm run demo          # first run ≈ 2–3 minutes, then open http://localhost:3000
```

Sign in with one of the demo accounts listed on the sign-in page (password `demo1234`): one per role, from
administrator and hospital director to technician and viewer, so you can see what each role can do.

The demo uses an embedded database (PGlite, Postgres running inside Node) in the `.pglite` folder. Stop it with Ctrl+C.
Run it again to restart with your changes kept (later starts take seconds), or delete `.pglite` to start over.

To use it for real on one laptop, double-click **Start Hospital PAMS.command** (or `npm run local`): it starts empty
except for the device catalogue, BOQ standards and default approval rules, asks you to create the administrator, and
keeps your data in `.pglite-data`. For a team, run it on a server: see [docs/deploy.md](docs/deploy.md).

## Users, roles and approvals

Everyone signs in. A role decides what a person can change; everyone can read.

| Role | Can change |
|---|---|
| Administrator | everything, plus users and settings |
| Director (competent authority) | approves awards, high-value POs and BOQs |
| Procurement officer | projects, specs, RFQs, suppliers, offers, award recommendations, POs, receiving, service contracts |
| Finance | approves POs above the finance threshold |
| BOQ planner | BOQs and BOQ standards |
| Biomedical engineer | assets, maintenance, work orders (assigns jobs), spare parts, recalls, service contracts, disposals, facilities and rooms, catalogue and PPM checklists, specs, BOQs, receiving |
| Technician | asset moves, maintenance records, working on assigned jobs and booking parts to them |
| Department head, Viewer | read only, plus reporting a fault |

Everyone signed in can **report a fault** (from the device page, or by scanning its QR label).

Users can be limited to some facilities. Purchase orders, BOQs and awards go through approval chains set under
**Administration › Approval rules & settings**. Tender committees follow Egypt's public contracts law (Law 182/2018):
envelope-opening and adjudication committees, required Ministry of Finance and State Council members above the value
thresholds, award approved by the competent authority, and the complaint window after notification.

## Biomedical engineering

Under **Assets** (release 2.2 / wave 3):

- **Work orders** (`/assets/work-orders`): anyone reports a fault from the device page or its QR label (phone friendly).
  The biomedical engineer assigns the job; the technician starts, puts on hold, completes (with the work done, the parts
  used and the downtime) and the engineer closes it. Response targets by priority, downtime, KPIs (open jobs, overdue,
  mean time to repair, uptime) and the effect on the device's status (a critical fault takes it out of service until
  repaired). Completing a job writes the maintenance record, so history and the next PPM date stay in one place.
- **Planned maintenance with checklists**: each device type has a PPM checklist (edited on its catalogue page,
  inherited from its group or category, or a built-in default). "Create PPM jobs" turns due visits into work orders that
  carry the checklist; completing one records every check (pass, fail, measured value).
- **Service contracts and warranty claims** (`/assets/contracts`): which devices a contract covers, its dates, response
  time and value. Every job shows whether the device is under warranty, under contract or not covered, with the claim
  status and reference. Contracts ending within 60 days raise a notification.
- **Spare parts** (`/assets/parts`): stock per hospital with minimum levels, receipts, issues to jobs and adjustments.
  Stock never goes below zero; crossing the minimum notifies the biomedical team; parts costs add up on each job.
- **Recalls and field safety notices** (`/assets/recalls`): match the affected devices by type, maker, model and serial
  numbers, raise inspection jobs, and track each device to actioned or not affected.
- **Disposal** (`/assets/disposals`): request, approval by the director (an approval rule you can change), then the
  disposal record (method, certificate). The device is condemned on approval and disposed when recorded.
- **Replacement plan** (`/assets/replacement`): devices scored 0–100 by age against service life, repair cost,
  failures, downtime, criticality and condition (an open recall adds to it); selected devices become a draft BOQ for
  their replacement.
- **Device performance and cost**: on each asset page — uptime, failures, mean time between failures and to repair,
  maintenance and parts cost against the purchase price.

## Finding things and keeping the register tidy

- **Search** (box at the top of every page): equipment by tag, serial number, maker, model or tag; device types; makes
  and models; rooms; departments; work orders; suppliers, tenders and purchase orders; BOQs — only what your role and
  hospitals allow.
- **Makes and models** (**Device catalogue › Makes and models**): the brands and models of each device type, with a
  reference price, end of sale and end of support. One click adds every make and model already typed into the
  register. Equipment forms offer them as you type, so a model is always spelt the same way, and each asset shows its
  model's support status.
- **Fleet and standardisation** (`/assets/fleet`): per device type, how many makes and models the hospital runs, the
  share on the most common model, units out of maker support or with no model recorded, and the hospital's
  **preferred model** (set here, with the reason).
- **Tags**: free labels on any asset (e.g. *loan*, *teaching*, *donated*), edited on the asset page; click a tag to list
  every asset that has it, or filter the register with it.
- **Executive summary** (**Reports › Executive summary**): one printable page per hospital — what needs attention first,
  equipment availability and value, maintenance response and repair times, overdue maintenance, maker support,
  contracts, warranties, deliveries and approvals. Print it or save it as a PDF.

## 3D view and CAD import

**Assets › 3D view** shows a facility as an interactive 3D building with every registered device in its room. It works
for any facility; floors imported from CAD show the real walls, doors, glazing and columns. What it does:

- **Look around**: rotate, zoom, spread the floors apart, isolate a floor, filter by equipment type or status, search a
  device and fly to it. Faults pulse in amber and red.
- **Two looks** (under **View**, remembered in your browser): the glowing *digital twin*, and a light *architectural*
  style with solid walls, floor slabs and pastel department colours that reads well in presentations and printouts.
- **Readable from afar**: over the whole building walls are drawn low (a cutaway), so each floor reads as a plate of
  coloured departments, with floor names beside the model and department names on the floors; basements fold away
  unless you switch them on. Choose a floor and zoom in for full-height walls, doors, columns and room names.
- **Devices**: close up, life-size models (bed, monitor on a pole, ventilator cart, scanner with its table, pump on an
  IV pole) standing on a ring in their status colour; from afar, glowing dots.
- **Selection**: a selected room (or the room of a selected device) is outlined with a glowing line, and the other
  equipment steps back.
- **Problem layers**: colour rooms or whole departments by open faults, overdue maintenance, devices past their service
  life, downtime over 12 months, equipment value or open recalls, with a legend and the most affected places.
- **Live**: statuses refresh every minute (and when you come back to the tab) without reloading.
- **Act from the model**: click a device to report a fault, record maintenance, open its jobs, move it to another room
  or set its exact spot (the same spot shows on the 2D floor map); click a room to list its equipment or add a device.
- **Plan vs installed**: choose a BOQ of the hospital. Rooms take their department's completeness colour (complete,
  mostly, partly, mostly missing), planned devices not installed yet show as white wireframe ghosts, and a list gives
  the missing, delivered-not-installed and extra units per department.
- **Nearest working device**: from any room, pick a device type ("defibrillator") and get the nearest working ones,
  same floor first, other floors through the lifts or stairs, with the route drawn.
- **Lifts and stairs**: stairs, lifts and service shafts (read from the room names) rise through the building.
- **Saved views**: name a view (camera, floor, layer, filters), keep it private or share it with the team, copy a link
  to it, or download a high-resolution image with a caption for reports and tender files.
- **Phones and tablets**: one bottom sheet with tabs on phones; the floor a link points at loads first and the rest
  stream in; a device that struggles switches itself to lighter graphics (no glow).

La Plaza Hospital is imported from its DWG floor plans (`seed-data/cad/la-plaza.json`, 9 floors, 1,414 rooms with
their real outlines, 5 m floor to floor, walls drawn 3.3 m high). Its equipment is an **illustrative fit-out generated
from room names** (beds and monitors in ward rooms, the critical-care set in ICU bays, a CT in the CT room…), marked as
demo data in each asset's notes, and its "equipment fit-out plan" BOQ is demo data too. Replace them with the real
register via Assets › Import. To import new or revised drawings, see `tools/cad/README.md`.

## Planning a BOQ

**Planning › BOQs** builds a bill of quantities from department scope with editable equipment-ratio standards; every
quantity shows its calculation.

- **Quick start** (`/boq/quick-start`): answer a few questions — hospital type (general, specialised, teaching, women
  and children) and ownership, beds (ICU, CCU, NICU and isolation pre-filled from the template), services (emergency,
  theatres, cath lab, CT, MRI, dialysis chairs, deliveries a year, clinics…), special conditions (trauma centre,
  teaching, oncology, transplant…), price tier and target budget — and review the priced BOQ before creating it.
- **Workload sizing**: departments answer planning questions (CT and MRI exams a year, deliveries, dialysis chairs…)
  and rules can size equipment from them ("1 CT per 15,000 exams a year"). An answer of 0 means none is planned.
- **Conditional rules**: extra equipment only when the hospital has a special condition (e.g. trauma centre: a dedicated
  trauma CT and rapid infusers), with the condition named in the line's explanation.
- **Companion items**: equipment that comes with another (a CT brings its injector, a delivery bed its CTG and infant
  warmer), topped up to what the department lacks.
- **Price tiers and scenarios**: the BOQ priced at basic, standard and premium side by side against the target budget;
  the tier can be set for the BOQ, a department or one line. Repricing never overwrites a price typed by hand.
- **Checks** tab: **risk flags** (one CT and no backup, ICU short of ventilators, critical areas without monitors or a
  defibrillator, essential items removed, over budget, unpriced lines, a life-critical fleet from a single maker),
  **fit to budget** (drops optional items, then moves recommended lines to a lower price tier, biggest saving first;
  essential lines and hand-typed prices are never touched; you review the list before applying it), **room
  requirements** (CT, MRI, angiography, X-ray rooms, theatres… checked against the real room areas from the floor
  plans, with shielding, power, HVAC and floor-load notes) and **benchmarks** (planned density per bed, room or 100
  hospital beds against reference ranges).
- **Phasing & costs** tab: departments open in up to four phases; a cash flow by quarter (an advance with the order,
  ordered ahead by device lead time, the rest on delivery) and the 5- and 10-year cost of ownership (maintenance,
  consumables, energy, replacements) with the devices that cost more to run than to buy.
- **Plan vs installed** tab, approvals, versions and Excel export as before.

The quick-start reference figures (`seed-data/boq-quickstart.json`: workload rates, conditional rules, companions),
the benchmark ranges (`src/lib/boq/benchmarks.ts`), the running-cost rates (`src/lib/boq/tco.ts`), room requirements
(`src/lib/boq/room-requirements.ts`) and lead times (`src/lib/boq/phasing.ts`) are **drafts for your biomedical team
to review**.

## Updating an existing installation

Pull the new code, run `npm install`, then `npm run db:migrate` (adds the new tables and columns; your data is kept).
`npm run demo` does this by itself and adds any new demo data. Migrations so far: up to `0015_wave5_models_tags`.

For a real installation, load the hospital's floors and rooms from its CAD import **without** demo equipment with
`npm run cad:load` (on the Docker server: `docker compose exec app npx tsx scripts/load-buildings.ts`). The going-live
checklist, including the hospital's own email, is in [docs/deploy.md](docs/deploy.md#going-live-at-a-hospital-la-plaza-pilot).

## Run it locally with PostgreSQL

Requirements: Node.js 22+, PostgreSQL 15+.

```bash
npm install
createdb hpams                                  # or create the database any way you like
cp .env.example .env                            # set DATABASE_URL
npm run db:migrate                              # create tables
npm run db:seed                                 # reference data + demo hospital, BOQ, tenders and 366 assets
npm run dev                                     # http://localhost:3000
```

If `DATABASE_URL` is not set, the app uses the embedded database in `.pglite` instead.

`npm run db:reset` wipes everything and reseeds. `npm run db:reset -- --only=none` loads only the reference data
(device catalogue, department types, BOQ standards, exchange rates) for a clean start with your own hospital.

The demo data uses real manufacturer brand and model names, but its compliance answers, prices and serial numbers are
invented for demonstration.

## Deploy

The simplest server setup is Docker: `cp .env.example .env`, set `DOMAIN` and `POSTGRES_PASSWORD`, then
`docker compose up -d --build`. That runs the app, PostgreSQL, automatic HTTPS and daily backups. Full guide, restore
steps and a no-Docker route: [docs/deploy.md](docs/deploy.md).

### Settings (`.env`)

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string (required). |
| `APP_URL` | address used to print | Public address of the app; QR asset labels link here. Set it in production. |
| `NEXT_PUBLIC_APP_TIME_ZONE` | `Africa/Cairo` | Time zone for "today", due dates and default dates. |
| `UPLOAD_DIR` | `./storage/uploads` | Where uploaded files are kept. Use a persistent volume and back it up with the database. |
| `COOKIE_SECURE` | on when `APP_URL` is https | Marks sign-in cookies Secure. |
| `SMTP_URL`, `MAIL_FROM` | — | Email for notifications (also switch email on in settings). |

### Uploaded files

Quotations, datasheets, certificates, PO scans and floor plans are stored outside the web root and served by `/files/…`
(`src/lib/storage.ts`). Only an allow-list of types is accepted (PDF, PNG/JPEG/WebP/GIF, Word, Excel, PowerPoint, CSV, text,
ZIP, DWG/DXF, email). Anything that isn't a PDF or image downloads instead of opening, and no uploaded file can run script
in the app. Floor plans must be raster images. Export PDF or SVG drawings to PNG first. Moving to S3-compatible storage
only touches `src/lib/storage.ts` and the `/files` route.

### Before going live

- Follow the checklist in [docs/deploy.md](docs/deploy.md): HTTPS, demo accounts off, one account per person, backups
  copied off the server.

## Rules the system enforces

- **BOQ:** every quantity shows its calculation. Manual overrides survive regeneration. Per-hospital-bed and fixed
  quantities are placed once per BOQ, on the main department of that type, not repeated per department. Approved BOQs
  are locked (make a new version). A BOQ that RFQs were raised from can't be deleted.
- **Tenders:** an RFQ freezes its items and quantities when created, so later BOQ changes don't change what suppliers
  were asked to quote. Comparison converts every offer to the project currency with the stored exchange rates. A line
  failing a mandatory spec item is non-responsive and counts as 0 in the offer's combined score. Awarding such an offer
  needs a written justification. Rejections need a reason. Once an offer is awarded its prices and compliance are locked,
  and an award can't be revoked while a purchase order raised from it is live.
- **Receiving:** you can't receive more than was ordered. A serial number can only exist once in the whole system.
  Every received unit becomes a tagged asset linked to its PO line, delivery, supplier, cost and warranty.
- **Assets:** assets, rooms and departments can only be linked within the same facility. A room or department that still
  holds equipment can't be deleted. Every move is recorded.
- **Work orders:** each step is allowed only from the right status and for the right role (report: everyone; assign:
  biomedical; work the job: maintenance). A job can't be closed before it is completed, and a device with open jobs
  can't be disposed. Reopening a PPM job puts its visit back on the schedule.
- **Spare parts:** stock only changes through recorded movements, atomically, and never below zero.
- **Disposal:** needs approval (director by default) before it can be recorded.
- **BOQ fit to budget:** the proposal is worked out again on the server when applied; essential lines and hand-typed
  prices are never changed, and every change is logged.

## Known limitations

- Rooms drawn by hand on the floor map are rectangles; rooms imported from CAD keep their real outlines. Moving an
  asset to another floor is done from its page, not by dragging on the map.
- Maintenance and parts costs are totalled per device and per job, but there's no maintenance budget view yet.
- One contact per supplier (extra contacts go in notes).
- "Nearest working device" distances are straight lines inside a floor plus a fixed cost per storey through the
  nearest lift or stairs, not a walk along the corridors.
- Lifts and stairs are recognised from room names ("Stair 3", "Elevator lobby"); lift shafts not drawn as rooms
  don't show.
- The planning reference figures listed under "Planning a BOQ" are drafts awaiting review.

## Where things live

| Path | What |
|---|---|
| `src/db/schema.ts` | The whole data model (Drizzle). Change it, then `npm run db:generate` and `npm run db:migrate`. |
| `seed-data/device-taxonomy.json` | Device classification (category › group › device type) with life, maintenance interval, price range, spec template. See `docs/taxonomy.md`. |
| `seed-data/boq-standards.json` | Equipment ratio standards per department type, with sources. See `docs/boq-standards.md`. Editable in the app under Planning › Standards & ratios. |
| `seed-data/department-types.json` | Department vocabulary (ICU, OR, RAD…) with Arabic names. |
| `src/app/procurement`, `src/lib/procurement` | Projects, suppliers, specs, RFQs, offers, comparison, POs, goods receipt. |
| `src/app/boq`, `src/lib/boq` | BOQ engine, builder, standards editor, Excel export. |
| `src/app/assets`, `src/app/facilities`, `src/app/catalogue`, `src/lib/assets` | Asset register, floor map, maintenance, facilities and room layout, device catalogue. |
| `src/components/assets/twin` | The 3D view (three.js scene, HUD, problem layers, saved views, nearest-device routing). |
| `src/lib/assets/work-orders.ts`, `checklists.ts`, `contracts.ts`, `parts.ts`, `recalls.ts`, `lifecycle-kpis.ts`, `plan-installed.ts` | Biomedical rules (pure, unit-tested); `*-server.ts` beside them do the database side. |
| `src/lib/boq/questions.ts`, `templates.ts`, `engine.ts`, `pricing.ts` | Quick start: planning questions, hospital templates, the BOQ engine, price tiers. |
| `src/lib/boq/fit-budget.ts`, `benchmarks.ts`, `risks.ts`, `room-requirements.ts`, `tco.ts`, `phasing.ts` | BOQ checks and planning (pure, unit-tested). |
| `seed-data/boq-quickstart.json` | Workload rules, conditional rules and companion items for the quick start. |
| `src/lib/assets/models.ts`, `tags.ts`, `src/lib/search.ts`, `src/lib/reports/executive-calc.ts` | Makes and models, fleet standardisation, asset tags, global search, executive summary. |
| `scripts/load-buildings.ts` | Loads real buildings from `seed-data/cad/` without demo equipment (`npm run cad:load`). |
| `tools/cad`, `seed-data/cad`, `scripts/seed/cad.ts` | DWG → building pipeline, imported buildings, and their import into the system. |
| `src/lib/asset-factory.ts` | The single place assets are created (tags, defaults, warranty). |
| `AGENTS.md` | Engineering conventions. |

## Tests

```bash
npm run typecheck
npm run lint
npm test
```
