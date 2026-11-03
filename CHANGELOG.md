# Changelog

## Unreleased — wave 10 (branch `wave-10`)

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

## Unreleased — waves 8 and 9 (branch `wave-8`)

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

## Unreleased — wave 7 (in progress, branch `wave-7`)

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
