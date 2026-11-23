# Changelog

## Wave 38 — the last missing features from the audit (not merged yet)

Missing features 10–17 of the wave 30 audit. One migration (0050).

**Procurement and money**
- **Arabic legal names on formal documents (#10).** Suppliers, committee members, hospitals and device types can carry
  a "Legal name in Arabic (for letters)"; it prints on award, regret and extension letters, committee minutes and the
  PO print, right to left. The interface stays English.
- **Budget years July–June (#11).** Settings › "Budget year starts in" (July by default). Budgets, the PO budget panel,
  the executive tile, the maintenance budget and the capital plan show "FY 2026/27". An existing "2026" budget reads
  as FY 2026/27 (1 Jul 2026 – 30 Jun 2027).
- **Bids from Excel (#13).** On an RFQ, download a bid template per supplier (items, quantities, spec lines; no
  prices), and import the filled file: it is checked first (wrong RFQ or supplier, unknown rows, bad prices, missing
  mandatory answers) and then creates or updates the supplier's offer.

**Assets and imaging**
- **Uptime in covered hours (#12).** A service contract can cover set hours (e.g. Sun–Thu 08:00–20:00, not on public
  holidays); its statement counts downtime and uptime inside those hours only. Public holidays per hospital, with the
  Egyptian holidays for 2026–2027 to add in one click (Islamic holidays marked approximate). No hours set = as before.
- **MRI helium and cryogen log (#14).** Readings per magnet (helium %, pressure, cold head, compressor, chiller) with
  alerts when helium is low, falling fast, a reading is missing, or the cold head stops. Open MRIs default to "no
  helium".
- **Exam counts from the RIS/PACS (#15).** Import a CSV or Excel of daily exam counts per device (by tag or AE title),
  checked before saving; it feeds Imaging use and usage-based PPM. Re-importing a day replaces it.
- **X-ray and CT tube life (#17).** Tubes per device with counter readings, warranty and expected life, a forecast
  replacement date and alerts; replacement history.

**Interface**
- **Dark mode (#16).** User menu › Look: Light, Dark or Same as my device, remembered per browser with no flash.
  Every colour pair passes WCAG AA in both looks; letters and labels always print light.
- **Sortable tables (U4).** A shared table with sorting (works without JavaScript), a column chooser and row ticks:
  used on the asset register (print labels for the selected devices), suppliers, purchase orders, users and a new
  list view of the catalogue.

- Figures to confirm: helium limits (70 %, 2 points in 30 days, a reading every 7 days); tube warning window (8 weeks).
- Checked: typecheck, lint, 1,091 tests, page check as three accounts on the demo.

## Wave 37 — missing features from the audit, and the last two security items (not merged yet)

Missing features 2–9 of the wave 30 audit, plus S13 and S15. Two migrations: 0048 (Microsoft/Google account link) and
0049 (tender file, calibration, radiation safety, delay penalties, landed cost).

**Procurement**
- **Letters to bidders and the comparison in Excel.** Award and regret letters from an awarded tender (the regret
  reason comes from the evaluation), and "Download comparison (Excel)" on the comparison tab. Only for people who may
  see prices; a sealed tender exports quantities and compliance only.
- **Late-delivery penalties (Law 182).** A rate per week of delay (default 1 %) capped (default 15 %) of the value of
  the late items, set per order. The PO page shows the penalty; Finance deducts it on the invoice, which then shows
  "Amount payable".
- **Landed cost by Incoterm.** Offers can carry freight, insurance, duty, clearance and local delivery costs (or use
  defaults by Incoterm from settings). The comparison and TCO tabs show the landed total next to the net price; the
  setting "Rank prices by" (net price by default, or landed cost) decides the ranking.
- **Procurement method and tender timetable.** The Law 182 method (public, limited, local, two-stage tender, public or
  limited practice, direct agreement, framework call-off), with a reason for anything but a public tender; a planned
  and actual date for each step, filled from the app where it knows them; checks on minimum periods; overdue steps
  alert procurement. The minimum days per method are planning figures to confirm with your legal adviser.
- **Clarifications and addenda register** on each RFQ: bidder questions and answers, numbered addenda that can move
  the closing date, and a printable "Notice to all bidders" that never names who asked (emailed when email is on).

**Assets**
- **Calibration of clinical devices.** Interval per device type, overridable per device; records with certificate and
  result; due, failed and never-calibrated lists and a compliance figure (Maintenance › Calibration). A failed
  calibration keeps the device out of service until a passing one is recorded.
- **Radiation safety** (Maintenance › Radiation safety) per hospital: ENRRA licences per room or device, physicist QC
  tests, staff dosimetry badge readings (name and role only) against the dose limit, and lead apron and other
  protective checks; each room shows "In order", "Due soon" or "Action needed". Limits and intervals are the usual
  figures: the radiation protection officer should confirm them against the licence conditions.
- **Wider alerts:** recalls pending, parts at reorder level, safety tests and calibrations due, test equipment
  calibration, licence and QC expiries, protective checks and high dose readings.

**Security**
- Two-step secrets are stored encrypted when `APP_SECRET` is set (32+ characters); old ones are encrypted at the next
  sign-in with a code (S13).
- Microsoft and Google sign-in link the account to the provider's own id at the first sign-in; a different account
  with the same email can't open it later (S15).

- Settings to set: `APP_SECRET` on the server; Admin › Settings › Delivery penalties and landed cost (placeholder
  figures) and Tender timetable (minimum days).
- Checked: typecheck, lint, 1,007 tests, page check as three accounts on the demo.

## Wave 36 — the rest of the wave 30 audit (not merged yet)

Medium and low findings left after waves 32–35. One migration (0047: indexes and data checks).

**Who sees prices (R9, decided by Hisham).** Supplier offers, prices, order values, budgets, framework agreements,
invoices and the spend reports are for Admin, Director, Procurement and Finance only. Department heads, viewers,
planners, biomedical engineers and technicians see tenders and orders (items, quantities, dates, status) with "Hidden"
for the money, and no Offers, Invoices, Budgets or Framework pages.

**Running the server**
- Docker passes every setting the app reads (assistant key, Microsoft/Google sign-in, pool, alerts) (CO-05).
- Migrations run under a lock and, on a database with data, after a safety copy (`hpams-premigrate-*.dump`) (CO-12).
- Smaller image (dev packages pruned) (CO-13); CI now builds the image and tests on PostgreSQL 16 (CO-14).
- Fonts ship with the app, so neither the pages nor the build need internet (R4).
- Backups are readable by the app only (0600) (S13); "Back up now" handles 65,536+ uploads (ZIP64) (CO-06).
- First-administrator setup can't run twice at once, and a production server needs `SETUP_CODE` (S10).
- 33 indexes on busy links, and checks that refuse negative money, zero quantities, over-receipt and negative stock (CO-10,
  DL-23). Checks apply to new and changed rows; old rows can be checked with `VALIDATE CONSTRAINT`.

**Procurement and money**
- Receipts, status changes, orders and invoices are safe against two people (or clicks) at once (DL-13, DL-14, DL-15);
  part returns too.
- A PO from an offer adds up to the offer total to the cent (DL-10); warranty end dates stay in the right month (DL-11).
- Missing exchange rates are listed, never counted as 0 (B7); book value "% left" is worked out over devices that could
  be valued (DL-17).
- CSV exports are safe to open in Excel (S11); Microsoft/Google sign-in needs a verified email, and Microsoft can be
  limited to your tenant (`SUPABASE_AZURE_TENANTS`) (S15); the assistant has an hourly question limit per person
  (Settings) and treats pasted text as data (S8, S9).
- Long lists say when they stop ("Showing the first 500…"); invoices are paged (B6, CO-11).

**Assets, 3D and pages**
- PPM, safety-test and depreciation dates fixed at month ends and life ends (A16, A17, A18).
- QR labels open the device by its tag, and warn when they would point to localhost (B4, B5).
- Building files with bad outline points are refused (A14); the CAD import stops with a reason instead of failing quietly
  (A15); the floor book opens without being blocked (A20); the 3D map and compass stay idle when nothing moves (A21);
  3D note and tour deletes use the app's dialog.
- The BOQ standards page is about 13 times smaller and the 3D page about half the size (R6).
- The page check sees "not found" and error pages, and runs as admin, viewer and a department head (R1, R3).
- Not done: encrypting two-step secrets (needs a new `APP_SECRET`; proposal in the wave 36 notes), linking Microsoft
  sign-in to the account's subject id (needs a column), and the missing-features list.
- Checked: typecheck, lint, 919 tests (3 more run with PostgreSQL), page check as three accounts, demo build offline.

## Waves 34 and 35 — sign-in, sealed bids, assets and history (audit fixes, not merged yet)

Last two waves that fix the wave 30 audit. Built on wave 33. One migration (0046: who recorded and approved each
invoice).

**Wave 34 — sign-in, sealed bids and controls**
- **Sealed prices stay sealed (S1, high).** In a two-envelope tender, offer totals, unit prices and financial scores
  show "Sealed" on every page (offers list, project, supplier, RFQ, new PO) until the financial envelopes are opened.
- **Two-step sign-in for Microsoft and Google too (S2, high).** SSO sign-in now goes through the same code check, or
  the set-up page when two-step is required and not set up yet.
- **Code tries last across sign-ins (S5).** After 5 wrong codes the account waits 15 minutes; parallel tries can't
  share one. Only a right code resets the count.
- **Sign-in throttling (S4)** books each attempt before the password check, can't be reset by flooding junk emails,
  and keeps a per-address limit. **(S6)** With TRUST_PROXY, the address recorded is the one the proxy saw, not one the
  browser made up. **(S14)** Turning on "two-step required" signs out the people without it. **(S16)** A broken link
  to a file answers "not found" instead of an error.
- **One award per tender (DL-24, DL-25).** A second award can't be recommended or applied while another offer holds the
  award or waits for its approval. If an approval ends but its effect wasn't applied (server stopped), the hourly run
  applies it. A budget overrun still warns (80 % and 100 % alerts) and does not block an approval.
- **Framework items (S3)** can only be changed by users of the agreement's hospital; "used by a PO" comes from the
  database. **Invoices (S7)** need three people: the recorder can't approve, and neither the recorder nor the approver
  can record the payment (admins included). In the demo: procurement@ records, finance@ approves, admin@ marks paid.

**Wave 35 — assets and history**
- **Downtime counted once (A1 critical, A2 high).** Overlapping work orders on the same device no longer double the
  downtime in contract statements (penalties), uptime, MTBF, the replacement score and the 3D downtime layer.
- **Condemned devices stay out of service (A3)**; **a device on loan stays on loan (A4)** when a fault is reported and
  returns to the right status; **run-to-failure types get no PPM (A5)** and are left out of compliance.
- **History replay (A7, A8, A10–A12).** Past days show the stored status or "No data", never today's live status;
  the daily record keeps the worst status of the day, so short outages show; days follow Cairo time; filters and
  legend use the replayed statuses.
- **3D view clean-up (A13).** Leaving the view frees its textures, listeners and graphics context.
- **Cairo dates everywhere (CO-09).** "Today" is the Cairo date in about 20 places that used UTC (the incident form
  rejected today's date between midnight and 2–3 am); incident times are read as Cairo time.
- Checked: typecheck, lint, 859 tests (about 60 new, each failing on the old code), page check of 123 page kinds,
  the 3D view opened and left twice with no errors. Not tried on screen: sealed prices (the demo has no two-envelope
  tender) and the Microsoft/Google two-step path (needs a real sign-in provider).

## Wave 33 — money right (audit fixes, not merged yet)

Second of four waves that fix the wave 30 audit. Built on wave 32. No migration.

- **Exchange-rate register (B1, critical).** Finance › Exchange rates: Finance records the Central Bank rate of each
  currency by date (or corrects and removes one); every change is logged. Rates older than 31 days are flagged.
  Until now the seed's 1 Oct 2026 rates were used for ever.
- **Amounts convert at the date that fixes them.**
  - Offers at the tender's price opening (financial envelopes, else the opening, else the RFQ closing date), so a
    closed tender's ranking no longer moves with the rate (B2). The comparison says which date it used.
  - Book value, cost of ownership and the purchase-order and assets-by-department reports at each purchase or
    order date (DL-18).
  - A date before the first stored rate uses the first rate.
- **No more USD stored as EGP (DL-05).** With no rate for the BOQ currency, catalogue estimates are left unpriced with
  a note to add a rate, instead of storing the USD figure (totals were about 50 times too low). Repricing clears old
  "kept in USD" notes.
- **Tender comparison** (DL-01, DL-02, DL-03): several lines of one device type in an offer are added up; an offer
  that misses a required item is shown as "Not ranked" and gets no overall financial or combined score while another
  offer quotes every item; "lowest single award" is priced at the required quantities. The minutes follow.
- **Currencies** (DL-06, DL-07): the executive budget tile converts each line to EGP; bonds are converted to the
  offer's or order's currency before the "short" check, and not checked when a rate is missing.
- **Orders, invoices, budgets** (DL-04, DL-08, DL-09, B3, DL-12): raising a quantity on a framework call-off draft is
  checked against the item maximum and the ceiling; an invoice can only hold lines of its own PO; paid invoices of a
  cancelled PO still count as spent, and a PO closed short releases its undelivered value; "Register missing assets"
  can no longer create duplicates when clicked twice.
- Not in this wave: DL-24/DL-25 (approval close and its effect in one transaction, blocking a double award or a budget
  overrun) needs a decision first: should a budget overrun block the approval or only warn?
- Checked: typecheck, lint, 801 tests (about 30 new, each failing on the old code), page check of 123 page kinds,
  the register and the comparison tried in the demo.

## Wave 32 — data safety (audit fixes, not merged yet)

First of four waves that fix the critical and high findings of the wave 30 audit. No migration.

- **Your edits survive restarts and updates (CO-01, critical).** The start-up seed used to overwrite device types (life,
  PPM interval, risk class), department types, BOQ rules, throughput rates, companions and the default standard set
  from `seed-data/` on every start. It now only adds rows that are missing. To reload them on purpose:
  `npx tsx scripts/seed.ts --only=none --refresh-reference`. Test: `scripts/seed.test.ts` (fails on the old seed).
- **The nightly backup can't empty the folder (CO-02, high).** `scripts/nightly-backup.sh` writes each dump to a
  temporary file, checks it is non-empty and readable by `pg_restore --list`, and only then removes old backups. The
  result goes to `backups/.nightly-status`.
- **Backup alerts (CO-07).** Administrators get a notification (and email, when set up) when the nightly backup fails
  or the newest good database backup is more than two days old. The Backups page shows the nightly result, ignores
  empty dump files when judging freshness, and marks them "Empty: not a usable backup".
- **Back up now files restore (CO-03, high).** The app image's PostgreSQL client now matches the server (16); set
  `PG_CLIENT_MAJOR=17` for a PostgreSQL 17 server such as Supabase. **(CO-04)** `unzip` is in the image, so the
  documented uploads `.zip` restore works. `docs/deploy.md` updated.
- **Confirmations (U1–U3, high).** One shared confirm dialog: red "Yes, do it" for destructive actions, the usual
  colour otherwise. Added to about 30 one-click actions that had none: BOQ department and line removal, standard set and
  rule deletion, "Reset to the built-in kits / standards", document, contact, contract device, framework item, floor,
  room, department, building, lift, flow step, link and draft, snapshot, 3D model file, backup file and chat removal,
  discarding drawing changes, withdrawing or cancelling a disposal and removing an RFQ invitation. The BOQ line delete
  no longer uses the browser's own box. The two `ActionForm` components are one (the assets one re-exports it).
- Checked: typecheck, lint, 769 tests (10 new), page check of 122 page kinds, start-up seed and nightly script run
  against PostgreSQL 16, the confirm dialog clicked through in the demo. Not checked here: building the Docker image.

## Wave 31 — merged 21 Nov 2026

`scene.ts` split. No change in what you see or do; no migration.

- `scene.ts` (about 2,600 lines, the three.js scene) is now about 1,230: the class keeps every field and every method
  with the same name and signature, so nothing that uses it changed. The bodies of 49 larger methods moved, unchanged,
  into five files by job, each taking the scene as `scn` where it said `this`: `scene-build.ts` (floors, walls, devices,
  furniture, shells), `scene-overlays.ts` (zones, routes, pathways, heat, notes, outlines, clashes, ghosts),
  `scene-view.ts` (looks, presets, framing, snapshots, walk and play), `scene-interact.ts` (pointer, picking, selection,
  placing and dropping) and `scene-labels.ts`.
- Generated from the parsed file, not retyped. Members marked `private` are now plain members, because the helper
  files need them (type-only; no run-time change).
- Checked: every 3D panel showed the same content as on the wave 30 build with the same database (the room labels
  differ between any two runs, as they follow the turning camera); pressing through the tools in every panel (views,
  walk, trauma route, a week's simulation, history, statuses, types) gave no browser errors.

## Wave 30 — merged 17 Nov 2026

The 3D view split into smaller files. No change in what you see or do; no migration.

- `twin-view.tsx` (about 2,550 lines) is now 300 lines: the page layout only. Its state and behaviour moved,
  unchanged, into `use-twin-view.tsx` (a hook that returns everything the view and its panels use), and the 18 blocks
  of panel markup became components in `twin/panels/` (floors, statuses and types; view settings; layers; plan;
  tours; history; saved views; routes; pathways; find; notes; the selection card).
- The split was generated from the parsed file, not retyped. Checked by clicking through every tool, a floor, a
  search and the right-click menu on the old and the new build with the same database: every panel showed the same
  text, and the new build had no browser errors.
- Not split: `scene.ts` (about 2,600 lines) is one three.js class; splitting it means moving groups of methods out to
  helpers that take the scene, which is a separate job.

## Wave 29 — merged 17 Nov 2026

The "set aside, or built only in part" list. Migration `0045_wave29.sql` (a new device status *On loan*, and the
loan's status before).

- **Fix: actions that hung on the demo and laptop installs.** Since wave 24 the audit trail looked up the signed-in
  user outside an open database transaction; the built-in database has one connection, so any action that logs
  inside a transaction (lending or returning a device, completing a work order, recording training, and others)
  waited forever and the app stopped answering. The lookup now goes through the transaction. A full PostgreSQL
  server was not affected.
- **Meter readings**: a mistaken reading can be corrected or deleted on the device page (kept in its history; a
  deletion that would leave the others going backwards is refused). Signing off planned maintenance, a work order or
  a maintenance visit asks for the meter reading when the device has a usage meter (optional; it makes the next
  due date exact).
- **Training sessions** can be corrected or deleted (delete the attached sign-in sheet first).
- **Lending a device out** sets it to *On loan* in the register; returning it puts back the status it had. A device
  on loan can't be lent again, and its status can only change through the loan.
- **Depreciation**: double-declining balance as well as straight line (Administration › Settings › Book value), used
  on device pages and in the reports; a new **Depreciation journal** report gives each device's charge for a period
  as journal lines for the finance system (Excel export).
- **Service cost and COSR**: a new table *By who did the work*: the company on the job, the contract's company, or
  the hospital's own team, each against the purchase cost of the devices it served.
- **Simulation**: the what-if can have its own staff shifts, closed hours and leave-unseen limits (switch *The
  what-if* above those three settings); patients can also give up in later queues (*Also in later queues*).
- **Audit trail**: before and after values for PPM and acceptance checklists, room zones and workshops (now logged
  at all), drawing revisions and on-site room checks, BOQ settings, BOQ lines and BOQ departments.
- **Passwords**: optional check against known data leaks (Administration › Settings › Sign-in), through the Have I
  Been Pwned service; only the first 5 characters of the password's SHA-1 hash leave the server. Off by default;
  needs internet; if the service can't be reached the password is accepted.
- **3D code**: the pieces that need no state moved out of `scene.ts` (to `scene-parts.ts`) and `twin-view.tsx` (to
  `twin-view-parts.tsx`). No change in behaviour (checked by screenshot). The panels still share the view's state, so
  a fuller split needs a store first.
- **Docs**: `docs/system-documentation.md` has a *Since release 3.0* section and current limitations and backlog; the
  handover's open items are current.
- Not done: **camera scanning on every phone** needs a small QR-reading library (`jsqr`) and adding a package
  needs Hisham's OK; **deleting old branches on GitHub** was refused by this session's permissions (wave-15 to
  wave-28 are fully in `main`; wave-13 and wave-14 hold commits that main reached another way). The breached-password
  check was not tried against the live service from here.

## Wave 28 — merged 17 Nov 2026

3D view and simulation. Migration `0044_wave28.sql`.

- **North arrow.** Each building can store where north is (Facilities › hospital › Buildings › Edit, "North,
  degrees", clockwise from the top of the plans; blank = not known). When it is set, the 3D view shows a north arrow
  on the mini-map and a small compass above it whose needle turns with the camera. The render title block's north
  arrow now turns to the building's north as well (it still points to the top of the plan when north isn't known).
  The demo general hospital's main building is set to 20° (demo value); La Plaza is left blank for someone who knows.
- **Own model files with licence and credit.** In Catalogue › 3D library an administrator can upload a `.glb` for a
  catalogue model with a required licence, credit line and source address. The file is checked by its bytes: glTF
  binary mark, version 2, length, chunks, readable description, at least one mesh, nothing linked outside the file,
  no Draco/meshopt compression; up to 25 MB. The 3D view draws it in place of the built-in shape (now in both the
  simple and detailed looks, in its own colours), scaled to the model's real size. Renders draw it too and list the
  credits under the preview, in the title block and on the floor book cover. Files uploaded before this wave show
  "Licence and credit not recorded" until uploaded again.
- **Small targets.** Controls under 24 px in the 3D view were measured in the demo and enlarged (see the commit for
  the list).
- **Simulation shifts.** The patient pathway simulation now has: staff numbers by hour of the day for porters and
  staff groups ("Staff by hour of the day"), beds and rooms closed for some hours ("Closed at night"), and patients
  leaving unseen after waiting longer than a set time for their pathway's first step ("Leaving without being seen",
  per pathway). Results show a "Left unseen" column and, per pathway, average waits by hour of arrival; each
  resource's chart also shows its average wait by hour. Left empty, every result is exactly as before (a test
  fingerprints the wave 15 output).

Not covered: the what-if column doesn't have its own shifts, closed hours or limits (the what-if uses the same as
the baseline); a patient can leave only before their first step (not from later queues or while waiting for a
porter); the compass isn't clickable (it doesn't turn the camera to north); the 3D view uses one north for the whole
hospital only when every building with a north agrees. Splitting `twin-view.tsx` and `scene.ts` into smaller files was not done: it is a large change with no visible
benefit, and it was left rather than rushed.

## Wave 27 — merged 17 Nov 2026

Lifecycle data and leftovers. Migration `0043_wave27.sql`. Built by three agents in parallel and merged.

### Maintenance: usage meters, test equipment on planned maintenance, loans and rentals, user training

- **Usage meters and usage-based planned maintenance.** A device type can carry a usage interval and unit
  ("every 5,000 hours", "every 10,000 scans", "every 1,000 cycles") on its catalogue page. Each device gets meter
  readings (date, reading, unit, who, note). Readings can't go backwards, except a reading marked "the meter was reset
  or replaced". Planned maintenance is now due on whichever comes first: the months interval or the date the usage
  interval runs out, estimated from the average use per day. The asset page has a **Usage** panel (last reading,
  average use a day, use since the last PPM, when usage-based PPM falls due, a form to add a reading). The
  maintenance due lists, the register's "Next PPM", the register export, the PPM compliance report and "Generate
  scheduled PPM visits" all use the earlier date. Scanners already recording monthly exam counts (Imaging use) count
  them as their meter, for types measured in scans, until the device has its own readings.
- **Calibration check on planned maintenance sign-off.** Completing a scheduled visit (Maintenance › Schedule ›
  Complete), recording completed maintenance on the asset page, and completing a work order (with or without a
  checklist) now offer "Test equipment used (optional)": the hospital's devices marked as test equipment, with their
  calibration dates. Completion is refused when a chosen instrument's calibration ran out before the day of the work;
  the message shows under the list. The instruments and their calibration dates on the day are kept with the visit
  and shown in the asset's maintenance history and on the work order. Reopening a work order clears them.
- **Loans and rentals** (Assets › Loans and rentals, `/assets/loans`). A loan: borrowed from or lent to, the other
  party (a listed supplier or any name), the device (a registered one by tag, or a description for a borrowed device
  not in the register), department, why, dates out / due back / returned, condition out and back, rental cost. A
  borrowed device has a **check before use**: planned maintenance and electrical safety test in date, with who checked
  and when (the page suggests the answer from the register when the device is in it). Tabs: open, overdue, returned,
  all. Loans also show on the asset page. An overdue loan notifies the hospital's biomedical engineers once (hourly
  alert job, key `loan_overdue:<id>`).
- **User training** (Maintenance › User training, `/assets/training`). A session per device type: date, trainer,
  kind (initial, refresher, by the supplier), department, notes, attendees (PAMS accounts and/or typed
  "Name, Department" lines) and the signed sign-in sheet as an attached document. The department page shows, for each
  device type in the department, who is trained and whose training is older than the set period (Administration ›
  Settings › "User training valid for", default 24 months), and "Nobody trained" where nobody is.
- Demo data (`scripts/seed/maintenance.ts`): usage intervals on ICU ventilators, CT scanners and dialysis machines
  (demo figures, not the makers'), meter readings on ventilators and dialysis machines (one meter replaced), test
  equipment on recent PPM visits, three loans (one overdue), four ICU training sessions (one older than two years).

Not covered:
- No meter reading is asked for when a PPM is completed; record one on the asset page on the day of the visit for an
  exact count (otherwise use is interpolated between readings, or counted from the first reading).
- A reading entered by mistake can't be deleted or edited from the screen.
- Lending a device out doesn't change its status in the register; there is no loan agreement document or approval.
- Training sessions can't be edited or deleted after saving (attendees can be added and removed).
- The usage intervals in the demo are placeholders: set the makers' values per device type.

### Finance: book value, service cost and COSR, budget totals in EGP, supplier document expiry

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

### Fixes: password rule, your sessions, more before-and-after audit values, GMDN code, commissioning plan in tabs

- **Password rule.** New passwords need at least 12 characters, may not be one of the most common passwords (also with
  digits or symbols around them, e.g. `Password123!`), may not repeat one character or a short pattern, and may not
  contain the person's email name. The rule is shown beside the field at setup, in Your account (change password) and
  in Administration › Users (new user, reset password). It applies only when a password is set or changed: people with
  older, shorter passwords still sign in, and the demo accounts keep `demo1234` (the seed hashes it directly).
- **Your sessions.** Your account lists where you are signed in: browser ("Chrome on Windows"), when signed in, last
  used and the address. This browser is marked. "Sign out" ends one session; "Sign out everywhere else" ends all but
  this one. Sessions now store only a short browser label (not the whole user-agent string) and the address
  (`sessions.ip`, migration `session_details`).
- **Before-and-after values in the audit trail** for: suppliers (details and active switch), purchase order header
  (dates, terms, notes; changed lines are counted), device types (risk and strategy, codes and classification), users
  (administrator edits, including the hospitals they may see), rooms (room form and room site survey; new rooms are
  now logged too), service contracts, budget lines. Saving a contract, budget line or device type with nothing changed
  says "Nothing changed" and logs nothing.
- **Budget lines:** editing an existing line now also checks access to the line's own hospital (before, only the
  hospital chosen in the form was checked).
- **GMDN code.** Catalogue › a device type › "Edit codes and classification" (needs `catalogue.edit`): GMDN code
  (5 digits, checked), GMDN term, UMDNS code, risk class, criticality, life expectancy, needs calibration. New
  equipment takes the new criticality and life; equipment already registered keeps its own.
- **Commissioning plan split up.** Tabs: Progress (curve and Gantt), Rooms, Dates for a group, Plan settings. The room
  table shows one floor, optionally one department, 25 rooms a page (about 130 fields instead of about 650). Saving
  returns to the same floor, department and page. Changing a field and then following a link asks "Leave without
  saving?"; closing or reloading the tab gets the browser's question. Gantt rows link to their floor and department.
- **Small click targets.** See the agent report: axe-core's WCAG 2.5.8 rule finds none on the pages checked; the
  commissioning check boxes were enlarged to 24 px.

Not covered:
- The common-password list is short (about 120 entries), built in; there is no check against breach databases.
- Older sessions keep their full user-agent string until they expire (at most 7 days); the page shows a label for both.
- The address is the first `X-Forwarded-For` hop, as in the audit log; behind no proxy it is empty.
- Audit diffs are not added to checklists, room zones/workshop flags, drawing verification or the BOQ, which were not
  in scope. The plan settings form of a commissioning plan is still logged without a diff.
- The leave warning clears when a form is submitted, even if the server then refuses it.

## Wave 26 — merged 17 Nov 2026

Screens for each role. Migration `0042_start_page.sql`.

- **Start page per role**: after signing in, each role opens its own page: technicians the work orders, biomedical
  engineers planned maintenance, department heads their department, procurement the projects, finance the
  invoices, planners the BOQs, directors the executive summary. Administrators and viewers keep the dashboard.
  A link to a page (for example from an email) still opens that page. Anyone can choose a different start page
  under *Your account*.
- **Dashboard trends**: a *Last 12 months* panel with work orders opened and closed each month (and whether the
  backlog grew) and the share of planned maintenance done within 7 days of the date planned.
- **Report library**: the reports page is grouped (Summary, Maintenance, Assets, Safety and security,
  Procurement) with each role's group first, and a search box. Three new reports, each printable and exported to
  Excel: *Work orders and response times* (by priority and department: still open, answered within the target,
  typical times to answer and to fix), *Device incidents* (harm, and whether the maker and the authority were
  told), and *Device security*.
- **On a phone**: *Scan a label* (Assets) opens a device's page from its QR label with the camera, or from a typed
  or hand-scanned tag. PAMS can be added to the home screen and opens full screen, with shortcuts to scan, report
  a fault and run a round. *Your account* explains how.
- **Next.js 16.4.3 → 16.4.6**: the build refused to run on 16.4.3 because of a moderate advisory
  (GHSA-mfr8-8qww-v76h, a feature PAMS doesn't use). A patch release, no other change. Two moderate notices remain
  in `exceljs` (through `uuid`); npm's only offered fix is an old major version, so it's left as is.

## Wave 25 — merged 17 Nov 2026

Security. Migration `0041_security.sql`.

- **Two-step sign-in**: after the password, a 6-digit code from an authenticator app on the phone (Google
  Authenticator, Microsoft Authenticator or any other; the standard TOTP kind). Anyone can switch it on under
  *Your account*: scan the square, type the first code, keep the ten backup codes. A code works once; five wrong
  codes send you back to the password.
- **Who must use it** (Admin › Settings › Sign-in): each person chooses, required for administrators, or required
  for everyone. Someone who must use it and hasn't set it up does so the next time they sign in, before they get
  in.
- **Lost phone**: a backup code signs you in once. Without one, an administrator resets two-step sign-in on the
  user's page (Admin › Users); the Users list shows who has it on.
- **Security headers** on every page: a content policy that runs only the app's own scripts (a one-time value per
  page), no framing by other sites, no content-type guessing, a short referrer, camera only for tag scanning, and
  HSTS when `APP_URL` is https. The only outside addresses allowed are the two Google font addresses.
- **Device network and security details** (the short form of the manufacturer's MDS2 statement) on each device's
  page: connection, IP and MAC address, network zone, operating system and until when it gets fixes, patient data
  stored or sent, encryption, malware protection, factory passwords changed, remote access, last security update,
  MDS2 on file. Saving counts as a review.
- **Device security** page (Maintenance): the recorded devices with what needs attention on each: operating
  system out of support, factory passwords, unencrypted patient data, no update in a year, no MDS2, not reviewed
  in a year.
- Not covered: sign-in through Microsoft or Google (Supabase) skips the PAMS code, because those accounts have
  their own second step. The two-step secret is stored in the database as it is, like any authenticator secret
  the server must read; protect the database and its backups. Fonts still load from Google; hosting them in the
  app would remove the last outside address.

## Wave 24 — merged 16 Nov 2026

Audit trail and data rules. Migration `0040_audit_and_data_rules.sql`.

- **Audit trail**: every entry now keeps the user's account, the address the request came from, and for an edit the
  values **before and after**. Admin › Audit log shows them (*Before and after*), and the CSV has them too.
  Editing a device's details and changing its status record their changes; other actions still record a summary
  line only (pass `diff(before, after)` to `logActivity` to add more).
- **The log can't be edited**: the database refuses to change or delete an activity entry.
- **A device's history is kept**: movements, maintenance, work orders, contracts, recalls, disposals and the rest no
  longer disappear with a device. The database refuses to delete a device that has history.
- **UDI and software version** on a device (Identity › Edit details). Paste the whole code from the label or the
  14 digits after (01); a wrong check digit is refused. Device types have a GMDN code column (shown in the
  catalogue; no edit screen yet).
- **Data checks in the database**: order and offer quantities above zero, prices not negative, discount 0–100 %,
  received quantity not negative, contract and framework end date not before the start, ceiling not negative.
- **Last-changed time** on 14 more tables (users, RFQs, deliveries, bonds, committees, requests and others).
- **Restore test** (Admin › Backups): loads a database backup into a scratch copy and counts what is in it, keeps
  the result, and warns when no test has passed in the last month. On PostgreSQL it reads the dump with
  `pg_restore --list`; a full restore into a spare database is still a manual step (docs/deploy.md).
- Not done: `archived_at`. Users, device types, models, suppliers, spare parts and approval rules already have an
  *active* switch that does the same job, so a second flag would only confuse.

## Wave 22b — merged 16 Nov 2026

The rest of the 3D view work from wave 22.

- **Tool rails**: a narrow strip of tool names on each side (Floors, Layers, View, Routes … and Find, Notes, Tours
  …) with the one open tool beside it, in place of the stacked panels. Each name shows its current state under it.
- **Opens on one floor**: a building of four floors or more opens on the floor nearest the ground, with the other
  floors as plain plates around it (filled below, outline above). *Whole building* is one click away. A link to a
  view, room or device still opens where it points, and directors, finance and viewers keep the whole building.
- **Mini-map and scale bar** (bottom left): the floor in plan with a dot where the view looks; click the map to
  move there. The bar shows a round length in metres at the current zoom.
- **Right-click** a device or a room for its actions: show details, fly to it, open the asset page, report a fault
  or an incident, show its floor only, room data sheet. A right-button drag still pans.
- Measured on La Plaza after waves 22 and 22b: tools on screen in 1.3 s, every floor loaded in 3.7 s (12.8 s before).
- Left out on purpose: a north arrow (the app doesn't know which way a building faces; it needs a north angle per
  building first). Labels already never overlap; the review was wrong to list that. Splitting `scene.ts` and
  `twin-view.tsx` into smaller files is still to do.

## Wave 23 — merged 16 Nov 2026

Safety records (Claude doc "PAMS review and plan"). Migration `0039_safety_records`.

- **Incidents** (*Maintenance › Incidents*): anyone can report that a device harmed someone, nearly did, or behaved
  dangerously, from the list or from the device's page. A quarantined device is marked out of service. The
  biomedical team is told, then records the root cause, the corrective action, and the dates the manufacturer and
  the Egyptian Drug Authority (EDA) were told. An incident with serious harm can't be closed before both were told.
  *Report sheet* prints the hospital's record, laid out to copy into the EDA's own form.
- **Risk and strategy** (*Maintenance › Risk and strategy*): each device type the hospital owns gets a risk score
  (equipment function + physical risk + maintenance need, after Fennigkoh and Smith; 12 or more is in the planned
  programme), a maintenance strategy and the written reason for it (AAMI EQ89). The page lists what is missing or
  doesn't add up, such as life support set to repair when it fails.
- **Electrical safety tests** (*Maintenance › Safety tests*, and on each device's page): readings after IEC 62353
  (protective earth, insulation, equipment leakage, applied part leakage). The app compares them with the limits
  for the device's class and applied part and says pass or fail; a required reading left empty fails. Shows what is
  due, what failed and the latest tests.
- **Test equipment**: a device can be marked as a tester or analyser with a calibration date. A safety test can't
  be recorded with an analyser whose calibration has run out.
- New permission `incidents.manage` (biomedical and administrators). Reporting an incident needs only
  `workorders.report`, which every role has.
- Demo data: scores for life-support and high-criticality types, an analyser per hospital (one out of
  calibration), a year of safety tests and four incidents.
- Fix for wave 21: figure cards with a long amount no longer make a phone page scroll sideways (found by the checks
  on GitHub, where the new fonts load).
- Not done: the calibration check applies to safety tests only, not yet to signing off a planned maintenance job.
  The limits are the usual IEC 62353 figures and should be checked against the hospital's copy of the standard.

## Wave 22 — merged 16 Nov 2026

3D view: lighter to run and easier to see (Claude doc "PAMS review and plan").

- **Draws only as often as needed**: full rate while the camera moves, a tour or pathway plays or something just
  changed; 10 frames a second when the view is still (it drew every frame before). The slow idle orbit stops after
  two minutes. Measured on the demo hospital: 61 of 287 frames drawn while still.
- **Floor linework**: sent compressed (La Plaza: 4.4 MB down to 1.1 MB) and kept by the browser; an unchanged floor
  is not sent again (300 bytes to confirm, not 100 KB).
- **Two looks, one click**: *Presentation* (light, built floors, no glow) and *Technical* (the glowing see-through
  model). Directors, finance and viewers start on Presentation the first time; a person's own choice is remembered.
- **More room for the model**: the app menu tucks away on the 3D page (the Menu button brings it back); one panel
  open per side, the rest folded to their headers; *Hide panels* and *Full screen* buttons in the top row.
- **Lost graphics**: if the browser drops the graphics context (sleep, driver reset), the view says so and offers a
  reload, where it used to go blank.
- Not done yet (still in the plan): opening on one floor with the others as plain slabs, a tool rail in place of
  the panels, the selection card with right-click actions, a mini-map with north arrow and scale bar, labels that
  never overlap, and splitting the two large 3D files.

## Wave 21 — merged 16 Nov 2026

New look, modules and shared UI parts (Claude doc "PAMS review and plan"; Claude design "PAMS modern luxury look").

- **New look**: a deep green-black menu, a pearl page, white cards with a faint shadow, pill buttons, one
  champagne-gold accent. Fraunces for page titles and big figures, Inter for everything else. All in the tokens in
  `globals.css`; every text colour still passes 4.5:1.
- **Modules**: the pages are grouped into nine modules (Planning, Procurement, Finance, Assets, Maintenance,
  Buildings & 3D, Patient pathways, Reports, Administration). *All modules* (`/modules`) shows a card per module
  with a live figure; the side menu shows one module at a time; each user sees the modules their role can open.
  The list of modules and their links is one file, `src/lib/modules.ts`.
- **Path and jump box**: every page shows where it is (Modules › Maintenance › Work orders). **Ctrl+K** (⌘K) opens
  a box to jump to any page by name.
- **Lists**: click a column heading to sort (up, down, off) on the asset register, work orders, purchase orders and
  suppliers; the sort is in the address. **Save this filter** keeps the current filters and sort under a name, in
  this browser.
- **Forms**: a validation message now shows beside its field, the field is marked and gets the focus. Confirm
  questions use the app's own box, not the browser's.
- **Waiting and errors**: a page shape shows while a page loads; a failed page says so in plain words with *Try
  again*; a wrong address gets a *Page not found* page.
- **Charts and icons**: a small chart kit (bars, donut, columns, trend line) and an icon set, both drawn as SVG with
  no new package. *Administration › Design parts* shows every shared part.
- **BOQ standards**: a standard set's rules fold by department (a set of 851 rules opened as one very long page).
- Not done: the commissioning plan page still has all its inputs on one page.

## Wave 20 — merged 16 Nov 2026

First wave of the Nov 2026 plan (Claude doc "PAMS review and plan"): quick fixes and automatic checks.

- **Contrast**: the grey hint text, the amber badges and the green badges are darker and now pass WCAG 2.2 (4.5:1)
  on every page. Three colour tokens changed in `globals.css`: `faint`, `warn`, `ok`.
- **Keyboard**: a *Skip to content* link is the first Tab stop on every page. Links inside a sentence are underlined.
- **Small fixes**: bigger click targets in the specification editor, the recall form and the 3D view; the device
  type filter has a name for screen readers; the pathway diagram can be scrolled with the keyboard.
- **Phone**: *BOQ standards* and *Pathway analysis* no longer scroll sideways.
- **Site data**: the Equipment 3D library counts how many models are verified, entered but not checked, or still on
  typical values; the site readiness sheet says which of the three its figures are.
- **Page check**: `npm run check:pages` opens every kind of page in the running demo (104) and fails on a server
  error, a script error, an accessibility finding or sideways scrolling on a phone.
- **Checks on push**: a GitHub workflow runs types, lint, unit tests and the page check on every push.
- New dev packages: `playwright` and `axe-core` (for the page check only).

## Wave 19 — merged 7 Nov 2026

From the interface review (Claude doc "PAMS interface review — what to improve").

- **Side menu**: groups fold and remember it; each role's own work comes first (technicians see Assets, procurement
  sees Procurement); the long Assets group is split into *Assets* (daily work) and *Asset management*; any link can
  be pinned to the top with its star.
- **Maintenance**: devices with **no PPM on record** are listed apart from real overdue visits (946 against 44 in
  the demo); every list puts life support first, then the longest overdue; 50 rows a page.
- **Dashboard**: choose one hospital; sign-ins no longer fill *Recent activity*; figures that open a list show an
  arrow.
- **BOQ**: departments fold, with a list to jump to one and *Open all departments*.
- **Lists**: filters apply as soon as a list changes (asset register, maintenance, work orders, offers, orders,
  projects, suppliers, models); the asset register keeps search and the common filters in view, the rest under
  *More filters*, and shows the active filters as chips to remove; on a phone it shows fewer columns, the make and
  room under the device type. On wide screens, table headers stay in view while scrolling.
- **3D view**: the View panel in groups — *Model*, *Colour rooms by* (one choice) and *Checks* — with the rest under
  *More view options*. Clash check, room templates and the simulation model load only when switched on, so the view
  opens faster.
- **Hospital page**: *Checks and planning* tab with drawing quality, space planning, clash check, room templates,
  pathways and commissioning, instead of buttons in the header.
- **Purchase orders**: the listed orders added up, with a total in EGP at the latest saved exchange rates.

## Wave 18 — merged 7 Nov 2026

- **Solid floors** (3D view › View › *Solid floors (not see-through)*): every floor is drawn as a built slab with
  solid room floors, so the floors below no longer show through. Works in both looks; off by default.

## Wave 17 — merged 7 Nov 2026

Migration `0037`. Update with `git pull` and `npm run demo`; your data is kept.

- **Equipment 3D library** (Catalogue › 3D library, roadmap phase 5): catalogue models drawn in 3D with the clear
  space each needs (patient transfer, staff, service, the MRI fringe field) and where its services connect (power,
  data, chilled water, quench, medical gases, drain). Typical figures by type, editable per model; a model's own 3D
  file (.glb, up to 25 MB) replaces the built-in shape in the 3D view. New built-in shapes: closed MRI, open MRI and
  C-arm. The first set — MRI, CT, X-ray and C-arm models from Siemens Healthineers, GE HealthCare, Philips and
  Wandong (i_Open 0.4T) — is added to the catalogue with typical site data, marked as typical. 3D view › View ›
  **Clearance zones and connections** draws them on a floor; a selected device lists them.
- **Space planning** (Facilities › hospital › Space planning, roadmap phase 6): gross internal area traced from the
  rooms, net, circulation and cores per floor, with net-to-gross and circulation share; per department the net area,
  largest uses, beds, devices, equipment density (devices per 100 m²) and bed places against the room templates'
  area per bed, with the rooms that hold more beds than their area allows. **Snapshots** save the schedule to compare
  before and after a change (or two snapshots). 3D view › Problem layer › **Equipment density**.
- **Clash and clearance check** (Facilities › hospital › Clash check, roadmap phase 7): devices placed on the plans
  that stick out of their room, overlap another device, have a clear zone running into a wall or blocked by another
  device, stand in a door, or are not MR-conditional inside an MRI's fringe field; for every device, one taller than
  the surveyed ceiling, rooms too small for their devices and clear zones, and non-MR-conditional devices in an MRI
  room. 3D view › View › **Clash check** rings them (red high, amber medium) and lists them; *Show in 3D* links
  spotlight the devices.
- **Clinical flow on the model** (roadmap phase 8): 3D view › Pathways › **Queue simulation on the model** runs a
  week of the published pathways (ten runs) and colours each room, scanner room and lift by how busy it is, lights up
  the scanners and lists every resource with its load, the wait one patient in ten has, and the peak hour.
  **Bed and stretcher clearance** marks, on the shown pathways' bed and trolley legs, points under 1.2 m clear,
  corridors under 1.8 m (a bed can't pass someone) and corners a 2.3 m bed can't turn; the pathway checks warn about
  them too. Widths are estimated from the walls.
- **Photoreal presentation** (roadmap phase 9): presentation renders draw **textured finishes** (welded sheet vinyl,
  theatre flooring, tiles with grout, wood planks, terrazzo, concrete) and **light fittings** as soft pools of light
  on the floor, both on by default. Tours save as a **flythrough video** (3D view › Tours › *Video*): the tour plays
  in the page and downloads as MP4 (or WebM where the browser can't make MP4), with each stop's caption.

## Wave 16 — merged 7 Nov 2026

Migrations `0034`–`0036`. Update with `git pull` and `npm run demo`; your data is kept.

- **Imaging and ICU presets** (3D view, top bar): one click tints every imaging (or ICU) room across the hospital,
  dims the rest, lights up their equipment and frames the camera on them; a floor shown on its own when they are all
  on one. A summary lists rooms, floors, devices by status and category, and the rooms with a device down.
- **Device status history**: each device's status is stored by day (changes only), every hour by the background job.
  The first run rebuilds the past year from work orders' downtime. 3D view › History now replays each device's status
  on the slider's day (*Device status on …*, on by default).
- **Detailed models in the live 3D view**: close up, devices are drawn with the detailed render models (beds, CT,
  X-ray, ventilators, incubators, theatre tables…), chosen by catalogue code; **Furniture** (illustrative room kits)
  appears on a floor shown on its own. Both can be switched off under View. Renders now pick models the same way.
- **Drawing quality** (Facilities › hospital › Drawing quality, roadmap phase 1): every floor's drawing checked — wall,
  door, glazing and column layers found; how each room outline was made (closed by walls, split from an open area, no
  outline found, drawn in the app); overlapping rooms; rooms under 1 m²; a scale that differs from the other floors;
  how well floors line up; floors older than the rest; rooms no door leads to. A score out of 100 per floor, the
  issues with their rooms, the source file, import date and a revision you can set.
- **Where each room came from**: room data sheets show the drawing, revision, how the outline was made and its
  confidence: *from the drawing*, *assumed* or *verified on site* (**Mark as verified on site**; a re-imported outline
  that changes loses the mark). Imports now record this; existing hospitals are filled in from their building files on
  the next start. 3D view › View › **Drawing confidence** colours assumed, guessed and verified rooms.
- **CAD import upgrade** (roadmap phase 2): DXF files as well as DWG; layer rules per building in the import config;
  **symbols** read from block names (equipment, beds and other furniture, sanitary fittings, medical gas outlets), each
  in its room; block names not recognised listed on Drawing quality, to add rules for; dimensions checked against
  the geometry (a plan at the wrong scale is flagged). Gas outlets from the drawing count towards room standards when
  the survey has no figure; drawn beds, equipment and fittings appear in the 3D view where the drawing shows them.
  Room data sheets list what the drawing shows in the room. A two-floor DXF sample runs the whole pipeline without
  real drawings (`tools/cad/README.md`).
- **Solid walls** (3D view, roadmap phase 3): on a floor shown on its own, drawn walls stand as solid walls from the
  floor to the slab above, with openings where the drawing has doors (a lintel above 2.1 m) and windows where it has
  glazing (sill to 0.9 m, glass, head from 2.1 m). Wall heights come from the floor-to-floor heights, not a fixed
  3.3 m. Surveyed room ceilings (room survey) show as orange outlines at their height. View › **Solid walls (one
  floor)** switches back to the light linework.
- **Clinical room templates** (roadmap phase 4): each room standard now lists the equipment the room needs (catalogue
  code, number per room or per bed space, clearance) and a minimum clear width. Rooms are checked against the devices
  registered in them and the width of their outline (room data sheet, room type sheet, 3D view). New templates:
  CSSD decontamination, CSSD packing and sterilising, triage, dental surgery, clinical laboratory, microbiology
  laboratory and blood bank. 3D view › View › **Room templates** colours rooms by their check; the room card shows the
  template and what is short. BOQ › Checks › Room standards compares the templates' equipment with the BOQ's
  quantities per department. Edited standards keep your copy: reset to the built-in set to get the new templates.

## Wave 15 — merged 7 Nov 2026

Migration `0033`. Update with `git pull` and `npm run demo`; your data is kept.

- **Room standards in BOQ checks** (BOQ › Checks › *Room standards*): every room of the BOQ's linked departments
  against the standard for its kind of room — area per bed space, ceiling, door, floor load, power, medical gas
  outlets, shielding and services — summed up per department, with what is most often short, the rooms below their
  standard and the rooms still to survey, each linked to its data sheet.
- **Gas outlets in the room survey**: 3D view › room › *Will it fit?* › **Edit survey** now records the medical gas
  outlets per gas (blank = not surveyed, 0 = none). Room data sheets and the checks compare them with the standard,
  per bed space when the room has beds.
- **Queue simulation extras** (all optional; with none set, results are as before):
  - *Staff on duty*: groups such as radiographers or nurses who work chosen rooms and scanners; a step there needs
    one of them as well as the room, so too few staff make a queue even with rooms free.
  - *Opening hours* for a room, scanner or staff group, with other hours for the what-if (e.g. MRI until 22:00).
  - *Appointment books*: a pathway's patients booked evenly through a session, with a no-show share.
  - *What-if: move a step to another floor*: see what it does to the lifts and the time in the pathway.
  - *Saved scenarios*: save every setting and the what-if under a name, private or shared, and load it later.
- **More detailed furniture and equipment in renders**: beds with rails and castors, swivel chairs, cupboard fronts
  and handles, theatre tables and lights, anaesthesia machines, incubators, CT and X-ray rooms, monitors and drip
  stands, and more. Still built in code (no model files, nothing to license); footprints unchanged.

## Wave 14 — merged 7 Nov 2026

Migration `0032`. Update with `git pull` and `npm run demo`; your data is kept.

- **Queue simulation** (Planning › Patient pathways › Queue simulation, plan item B3): every published pathway,
  patient by patient, over a day or a week. Patients arrive by each pathway's hourly profile and wait for rooms,
  scanners, beds, porters and lift cars; results from many runs show how busy each one is, the average wait, the wait
  one patient in ten exceeds, the longest queue and the busiest hour, with a chart by hour, plus time in each pathway.
  **What-if**: change any number (one more CT, a second bed lift, more porters, more patients) and compare side by
  side. Runs in the browser in about a second.
- **Commissioning timeline** (Assets › Commissioning, plan item C5): for a new building or wing, rooms handed over,
  installed and accepted week by week, planned against actual. A progress curve, a Gantt by floor and department
  (with devices still on order when a project is linked), a Commissioning tab on the project, and a week slider in
  the 3D view that colours rooms by stage, with rooms behind the plan in red.
- **Room standards** (Hospital › Room standards): a room data sheet per room type — area, ceiling, door, floor load,
  finishes, medical gas outlets, power, data, lighting, ventilation and special services. Each room's own sheet now
  compares its survey with its standard. Draft figures from HBN, HTM 02-01 / 03-01 and FGI, editable.
- **Backups page** (Administration › Backups): it was listed in wave 12 but never reached the code (a `.gitignore`
  rule hid the folder). Now there, and **Back up now** also works on PostgreSQL and Supabase (`pg_dump`). A failed
  backup never replaces an earlier one. The Docker image includes the PostgreSQL client; see `docs/deploy.md`.
- **Assistant**: looks up BOQs, service contracts and recalls too; chats are kept for each person (the last 50) and
  can be reopened or deleted; any answer, or a whole chat, downloads as a Word file.
- Demo: La Plaza's fourth floor as an opening in progress (made-up dates).

## Wave 13 — merged 5 Nov 2026

Migration `0031`. Update with `git pull` and `npm run demo`; your data is kept.

- **Department heads edit their own pathways**: an administrator picks the departments each person looks after
  (Administration › Users › *Departments they look after*). They can then edit patient pathways whose steps are all
  in those departments, and set the access zones of their own rooms. Other pathways stay read-only for them.
- **Sign in with Microsoft or Google** through Supabase Auth (optional). Supabase confirms who someone is; they get in
  only if an active PAMS user has the same email, with that user's role and hospitals. Password sign-in stays.
- **Supabase as the database** (optional): `DATABASE_SSL`, an optional CA file and pool size for a hosted Postgres.
  See *On Supabase* in `docs/deploy.md`.
- **Assistant** (off by default): an administrator switches it on in settings and sets `ANTHROPIC_API_KEY` on the
  server. It answers questions about devices, work orders, projects, suppliers, POs and budgets by looking them up,
  within the person's permissions and hospitals, can't change anything, and drafts specifications and letters.
  Offer prices are never given to it. The audit log records each use and which look-ups ran, not the question.
- Law 182 "check against the regulations" notes removed (the bond rates and two-envelope steps are confirmed).

## Wave 12 — merged 3 Nov 2026

Migration `0030`. Update with `git pull` and `npm run demo`; your data is kept.

- **My department** (Assets): a department's equipment, out of use, open jobs, maintenance in the next 30 days,
  devices past service life, and **equipment requests** (new or replacement, priority, reason). The director
  approves them for a year (they then show in the capital plan) or declines with a reason; approved requests become
  a BOQ.
- **Rounds and stock-take** on a phone: scan the QR label (camera where the browser reads QR codes), a handheld
  scanner or type the tag; mark OK, fault (raises a job) or moved (moves it). Results wait on the phone without
  signal and are sent when it returns. A stock-take lists what wasn't found.
- **Audit log** (Administration): search who did what by person, record, text and dates; CSV export.
- **Backups** (Administration): backup files and their age, *Back up now* (the built-in database while running, and
  the uploaded files), a restore check that each archive opens, and downloads.
- **Supplier contacts** by role (sales, service, finance…); the sales contact is used on validity letters and the
  service contact is shown on contracts.
- **Maintenance budget** (Maintenance › Maintenance budget): upkeep per department (completed maintenance and
  repairs plus each contract's share) against maintenance budget lines, with a full-year forecast. Budget lines now
  have a kind, capital or maintenance.
- **Executive summary** adds tenders in progress, capital budget use and pathway readiness, and is announced to
  directors and administrators each month (by email too when email is set up).
- **Room outlines**: draw rooms corner by corner in the layout editor, drag corners, add or remove them.
- **Floor map**: move a device to a room on another floor from its panel.
- **Room data sheet** (printable, from the 3D room details): area from the drawings, survey, services, finish,
  installed equipment and the department's plan against installed.
- **BOQ scope from the drawings**: beds take the larger of the declared beds and those drawn in the rooms; *Update
  beds and rooms from the drawings* on the scope tab.
- **Clean and dirty routes**: two new starters (CSSD to theatres, ward waste to the waste store); the 3D Pathways
  panel and the pathway analysis show corridors both use and lifts both use at the same hours.
- **Smoother 3D**: walking networks are built in a background worker.

## Wave 10 — merged 3 Nov 2026

Migration `0029`. Update with `git pull` and `npm run demo`; your data is kept. The demo adds a budget line per
hospital (labelled demo) only when none exist.

- **Budgets**: budget lines per hospital and year, optionally per department or project. POs are charged to a line;
  each line shows spent (approved invoices), committed (approved POs not yet invoiced) and waiting for approval.
  Finance is notified when a PO takes a line past 80 % or 100 %.
- **Supplier invoices and three-way match**: record an invoice from the PO; it is checked against the quantities
  ordered and received and the PO price (1 % tolerance). Approve, approve with a reason, reject, mark paid. CSV
  export for finance.
- **Framework agreements**: agreed items and prices with a supplier up to a ceiling; a call-off drafts a PO at those
  prices within the dates, the ceiling and each item's limit.
- **Supplier scorecards** on each supplier: on-time delivery, acceptance without issues, warranty response, invoices
  matching the PO, graded A–D.
- **Delivery, installation and acceptance**: a checklist per device type (default list until you set your own);
  biomedical engineering fills it and signs, the department signs; acceptance puts the device in service and starts
  its warranty for the months on the PO.
- **Tender tab** on each project: one or two envelopes (prices stay sealed in the comparison and on offers until the
  financial envelopes are opened, and an award can't be recommended before), bid and performance bonds against the
  required 1.5 % and 5 % with expiry, printable committee minutes (opening, technical, financial, award) and a
  validity extension letter per offer.
- **Technical evaluation sheet**: every specification clause against every offer with the offered value and the
  datasheet page (new *Page* column when recording compliance), mandatory failures highlighted, for the committee to
  sign.
- New permissions: `budgets.edit`, `invoices.edit` (procurement, finance), `invoices.approve` (finance).

Check the bond rates, the two-envelope steps and the minutes' wording against the Law 182/2018 executive
regulations before relying on them.

## Waves 8 and 9 — merged 3 Nov 2026

Migrations `0024`–`0028`. Update with `git pull` and `npm run demo`; your data is kept. The demo adds clearly labelled
demo figures (imaging use, budgets, contract terms, offer running costs, typical site values) only where none exist.

**Wave 8 — pathways, routes and the 3D view**
- **Pathway building checks**: publishing is blocked when a step's room was removed by a drawing update or a bed leg
  between floors has no bed lift; warnings for estimated routes, staff-only rooms crossed and unknown equipment codes,
  each with *Fix in 3D*. Drawing reviews list the pathways affected.
- **Printable pathway sheet** and a **pathway book** of every published pathway.
- **Lift waits by hour**, used for routes at the pathway's busiest hour.
- **Workshop route**: mark biomedical workshops in 3D; work orders show the walking distance and time from the nearest.
- **Walking network** tab on each hospital: coverage per floor, unreachable rooms, fixes, zones and workshops.
- **Photos on notes** (camera on phones), copied to the work order a note becomes. Fixes uploads to work orders.
- **Jobs in 3D**: a progress ribbon for a device's open jobs.
- **Render options**: eye-level and current-view renders, labels, people for scale, JPEG, all floors as a ZIP, and
  saving a render to the hospital's documents.
- The 3D find box lists rooms as well as devices.

**Wave 9 — imaging and equipment planning**
- **Will it fit?** Site requirements per make and model, room surveys, a fit check with outlines in 3D (best spot,
  turn, place by hand, MRI 5 gauss line and the rooms it reaches) and a printable site readiness sheet.
- **Imaging use**: monthly exams per scanner against planning capacity, uptime, exams lost to downtime, paste import.
- **Capital plan**: replacement by year and department against a budget, turned into a BOQ.
- **Total cost of ownership** in the offer comparison, with our own maintenance history for the same models.
- **Contract performance**: response, repair and uptime terms, penalties and a monthly statement.
- **Recalls**: serial ranges, department heads notified, pending devices shown in 3D.

Not done here: go-live hardening (C4) needs the production server and its settings.

## Wave 7 — merged

Migrations `0016`–`0023`. Update with `git pull` and `npm run demo`; your data is kept.

- **Lift cores**: declared once per hospital under Facilities › Lifts (bed, public, service, AGV; stops per floor;
  cars, capacity, typical wait). Suggested from lift lobbies in the drawings and marked *assumed* until confirmed. The
  3D view draws them as shafts, and "nearest working device" only takes a lift that stops on the device's floor.
- **Presentation renders**: *Presentation render…* in the 3D view makes a furnished dollhouse image of a floor or one
  department. It shows solid walls with grey tops, floor finishes by room type, registered equipment plus
  illustrative room-kit furniture, soft shadows and ambient occlusion. Labels and the title block are drawn by the
  app. Export at 1080p, 4K or 8K (tiled), or as a printable floor book of every floor.
- **Real-size equipment and placing devices in 3D**: devices have a real size (L × W × H), typed in at registration
  or taken from the make and model, device type or a typical size for the group. The 3D view and renders show them
  at that size and turn. A "To place" panel lists registered devices without a room. Pick one and drop it on the
  plan: a real-size ghost turns green when it fits inside a room, R turns it, and Undo lasts 30 s. "Move on plan"
  picks up a placed device the same way.
- **Update drawings in place**: Facilities › (hospital) › Update drawings, or `npm run cad:update -- <file> [--apply]`.
  Revised drawings are matched by floor level and room code and checked on a review screen before anything changes.
  Equipment, history and lifts are kept, and rooms that still hold equipment are never removed.
- **Walking routes (step 7a)**: routes follow corridors and doors on a walkable network built from each floor's
  wall lines. Rooms cut off in the drawing get assumed doors, which are listed, and sterile rooms are closed to
  through-traffic. Between floors, each journey uses only the lifts it may (beds by bed lifts) or stairs on foot,
  with time by pace, lift wait and storeys. On La Plaza 97.7 % of rooms are on the network. The 3D view has a Routes
  panel: a walking-network layer with coverage per floor, and an early look at the trauma route (ambulance → Resus →
  CT → ICU by bed, distances and times per leg). "Nearest working device" now ranks by real walking time and draws
  the route.
- **Patient pathways (step 7b)**: Planning › Patient pathways. A pathway is a set of steps (a place in the hospital,
  minutes, who goes with the patient, equipment needed) joined by arrows with a share of patients, transport and
  urgency. Five starters (trauma, elective surgery, maternity, outpatient imaging, ICU to CT and back) find this
  hospital's departments and rooms by themselves. The page draws the pathway, works out patients a day at each step
  and checks it as you edit: unreachable steps, dead ends, loops with no way out, shares not adding to 100 %.
  Publishing freezes a version; changes go into a new draft version. Pathways export to a file and import into another
  hospital, matched by department and room codes. Planners, biomedical engineers and admins edit; everyone can view.
- **Pathways in 3D (step 7c)**: a Pathways panel in the 3D view shows published pathways in the building, one colour
  each. Each arrow follows its real walking route (thicker for more patients, dashed where partly estimated), and the
  steps get numbered markers. *Play patients* animates patients picked by the shares, at 10× to 600×; long stays are
  shortened to a few seconds. The pathway card gives distance walked, time moving, time in care, floor changes and
  lift trips per patient (averaged over the branches), plus the longest leg; click a leg to fly to it. **Equipment
  readiness**: the card and the pathway page check each step's equipment in its room or department, live ("Intensive
  care: Ventilator, ICU in the room is out of action"). *Show in 3D* on a published pathway opens it there.
- **Pathway analysis (step 7d)**: Planning › Patient pathways › *Analysis* puts every published pathway together.
  It shows room load at the busiest hour (from each pathway's arrival profile), beds needed for long stays, scanner
  load against yearly capacity, and equipment readiness. Each figure shows its working on hover, and the page
  downloads as an Excel workbook with an Assumptions sheet. In the 3D view the Pathways panel adds lift load (busiest-hour
  trips × round trip ÷ car time), a corridor traffic layer (patients a day per 2 m of corridor) and a side-by-side
  comparison of the pathways shown. *Show in 3D* on a draft opens it next to the published version. The dashboard
  lists published pathways missing working equipment. Starters now keep clinic steps on the whole department and
  don't borrow another department's room. How every figure is worked out, with a worked example:
  `docs/pathway-analysis.md`.
- **Canvas mode for pathways (step 7e)**: *Canvas* on a pathway page. Drag steps around (they snap to a grid and stay
  where you put them). Draw an arrow by dragging from a step's ● onto another step; it takes whatever share the
  step's other arrows leave. Pan by dragging the background; zoom with the buttons or Ctrl + wheel. Click a step or
  arrow to see it beside the canvas and edit it. Keyboard: Tab to a step, arrow keys move it. *Tidy up* returns to
  the automatic layout. Your choice of diagram or canvas is remembered.
- **Notes in the 3D view**: add a note on a selected room or device, or on any spot of the floor shown. A note can be
  for someone, who then gets a notification. Notes show as markers in the model and in a Notes panel. They are
  closed by their author, the person they're for, or anyone who edits assets. A note on a device turns into a work
  order with one click and links to it.
- **Live alerts**: a new fault (a new job, or a device going out of service) since the last minute's refresh flashes
  at the device and pops up a message with *Go there*.
- **Hover cards**: hovering a room shows its equipment, devices down, open jobs and notes; hovering a device shows its
  status, jobs and notes.
- **Drag to move**: on a floor shown on its own, press and hold a device, then drag it to another room. It drops at
  real size, with *Undo* for 30 s, the same as *Move on plan*.
- **Guided tours (step 7f)**: chain views of the model into a tour with a caption and timing per stop, play it full
  screen (← → step, Space pauses, Esc ends), share it with the team, and copy a link that plays it.
- **History time slider**: load the last 7, 30, 90 or 365 days and drag through them, or play them, a day every half
  second. Faults (red), repairs (green), moves (blue) and installations (purple) rise at each device, fading with age.
  The panel shows a per-day bar chart and the latest events. Device status at a past moment isn't stored, so it isn't
  replayed.
- **Walk mode**: *Walk this floor* (or W) puts you at eye height on the floor shown, kept to the walkable space. W A S
  D or arrows, Shift to hurry, drag to look, Esc to stop; a round stick on tablets.
- **Keyboard shortcuts**: F find, 1–9 floors (as listed), 0 whole building, L look, R reset, W walk, Esc clear, ? to
  list them. Off while typing.
- README and user guide cover the wave 7 features.
- **Route fixes and access zones (rest of step 7a)**: with the walking network on, *Add an opening* (a door the
  drawing doesn't show) or *Close a gap* (one it leaves open) by clicking its two ends. Fixes are kept by position, so
  they survive rebuilding and drawing updates. Routes, pathways and nearest-device rankings use them at once. The
  rooms routes can't reach are listed. Each room has an **access zone** (public, patient, staff, sterile, isolation,
  or read from its name); sterile and isolation rooms are closed to through-traffic. Facilities editors change both.
- **Renders (rest of part F1)**:
  - *Equipment*: installed, planned (from a BOQ) or both. Planned units are drawn in pale blue in their department's
    rooms, and the title block says which.
  - A hospital's **logo and accent colour** (Facilities › details) appear on renders and floor books.
  - Render settings can be **saved with a view**; *Render* on that view reopens them, so a book can be remade in one
    click.
  - **Room kits** are editable under Planning › Room kits (planners and biomedical engineers): name patterns or room
    types, floor finish, and furniture lines like "bed per 11 m2 max 4 with bedside". The built-in set lives in
    `seed-data/room-kits.json`.
- Demo restarts no longer crash on the work-order seed.

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
