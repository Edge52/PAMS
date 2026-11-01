# Wave 7 plan — interactive 3D and patient flows

Status: **draft for discussion, revision 3** · 1 Nov 2026 · what changed in each revision is listed in §12

## 1. Goals

1. Let you describe **how patients move through the hospital** (and, later, staff, supplies and waste) as pathways you
   draw yourself, and see them **in the building**, with distances, floor changes, timings and load.
2. Make the 3D view **a place you work in**, not only look at: drag things, leave notes, present, get live alerts.
3. Give planning answers you can't get today: *"Is the CT in the right place for trauma patients?"*, *"Which lift is the
   bottleneck at 10 am?"*, *"Is everything this pathway needs actually working right now?"*
4. Produce **presentation renders**: furnished, photo-style floor images and a floor book for client presentations,
   tenders and board papers, made from the real model rather than drawn by hand.

**How we'll know it worked** (checked at the end of the wave, on La Plaza):

| Measure | Target |
|---|---|
| Clinical rooms reachable by a walking route | ≥ 98 % after fixes; 100 % of rooms used by the starter pathways |
| Route plausibility | 20 hand-picked routes reviewed on the plan by the biomedical team: none crosses a wall or a sterile zone |
| Trauma question | "ER → CT → ICU: distance, lifts, minutes" answered in the 3D view in under a minute, figures matching a hand calculation within 10 % |
| Readiness | A device put out of service shows as a blocked pathway step within one refresh (≤ 60 s) |
| Tablet | 3D view with one pathway playing stays usable (≥ 30 fps target) on the lowest tablet we support |
| Renders | A furnished La Plaza floor at 4K in under 30 s on an ordinary laptop; every label spelled exactly as in the register; floor book for all 9 floors in one click |

## 2. Where the 3D view stands (release 3.0)

| Strong today | Gap this wave closes |
|---|---|
| Whole building from the drawings, lifts and stairs, façade, two looks | Shows **equipment only**, nothing about people or process |
| Live status, problem heat maps, plan vs installed | Routes are **straight lines through walls** plus a fixed cost per floor (25 m per storey by lift, 40 m by stairs, `twin/nearest.ts`) |
| Act on devices through the side panel (fault, move, exact spot) | Interaction goes **through forms**; no drag and drop, no notes in the model |
| Saved views (`twin_views`), presets, section cut | **No time dimension** (replay), **no guided presentation**, orbit-only navigation |

## 3. What the drawings can and can't give us (checked 1 Nov 2026)

Before designing routes we tested the La Plaza drawing data (`seed-data/cad/la-plaza.json`: 9 floors, 1,414 rooms,
wall, door, glass and column linework at 10 units per metre). These were quick scripted tests, not the final
algorithm, but they change the design:

| Check | Result | Consequence |
|---|---|---|
| **Lifts from room names** | Only the garden floor has rooms named as lifts ("ELEVATOR LOBBY", "Parking Elevator Lobby"). Floors B2 and GR–F5 have **"AGV Lobby"** (automated-trolley lifts) and stairs only | "Found from room names, as today" doesn't work for patients. Lift cores must be **declared once per building** (§4 A) |
| **Rooms connected by touching outlines** (≥ 0.9 m shared edge, door lines confirming) | **66 %** of non-technical rooms reach the main corridor network; floors F3–F5 only 30–60 %. On the garden floor *Resus/Trauma 1* and the *Elevator Lobby* come out unreachable | Room outlines alone are too gappy to route on |
| **Walkable space carved from wall lines** (25 cm grid, walls, glass and columns blocked) | **80 %** reach the network, 76–86 % on ward floors; misses differ from the first method (e.g. *CT* on the garden floor, basement lobbies) | Better, and routes follow corridors naturally, but still needs the two methods combined plus manual fixes |
| **Room identity on re-import** | Rooms are unique per floor by code (`rooms_floor_code_uq`), but re-importing revised drawings means **deleting the facility** (`tools/cad/README.md`) | Anything tied to rooms (pathway steps, notes, route fixes) would be lost on the next drawing revision. We need an in-place re-import first (§6, step 7-0) |

## 4. What we'll build — overview

| Part | What you get | Depends on |
|---|---|---|
| **0. Groundwork** | Re-import revised drawings without losing data; declare lift cores | — |
| **A. Walking routes** | Real routes along corridors, through doors, by the right lift or stairs; used everywhere a route is drawn | 0 |
| **B. Pathway editor** | Describe a patient pathway as steps and arrows, tie steps to departments or rooms, add times, transport, equipment and volumes | 0 |
| **C. Pathways in 3D** | The pathway drawn through the building, animated patients, distances and times per leg | A, B |
| **D. Pathway analysis** | Load on rooms, equipment, lifts and corridors; bottlenecks; live equipment readiness; compare versions | C |
| **E. Interactive 3D** | Drag to move, notes in the model, live alerts, hover cards, guided tours, time slider, walk mode | A (walk mode only) |
| **F. Presentation renders** | Furnished, photo-style floor renders (dollhouse cutaway, soft shadows, real labels), high-resolution export and a printable floor book | — (uses the existing 3D view) |

**Cut line.** The wave is big, so it's split into what must ship and what can slip to wave 8 without hurting the rest:

| Must | Should | Could |
|---|---|---|
| 0, A, B (list mode), C, equipment readiness | Rest of D, B canvas, drag to move, notes, live alerts, hover cards, **F1 render mode and floor book** | Guided tours, time slider, walk mode, **F2 AI finish** |

Part F doesn't depend on routes or pathways, so it can be built in parallel with 7a–7d, or brought forward if renders
are needed for a client sooner.

## 5. Design

### 0. Groundwork

**In-place drawing re-import.** Loading a revised drawing for a building that already exists merges by floor code and
room code instead of starting over:
- same code → outline, name and type updated, everything attached (assets, pathway steps, notes) kept;
- new code → room added; missing code → room marked *removed* (not deleted) while it still holds equipment or is used
  by a pathway, and listed for review;
- a review screen before applying: rooms added, renamed, reshaped, removed, and which assets, pathway steps and route
  fixes each change touches.

**Pathways and notes refer to rooms by floor code + room code**, not by database id, so they survive a re-import and can
be exported and imported between installations.

**Lift cores.** A small editor under *Facilities › floors* to mark each lift core once: position, the floors it serves,
its kind and its capacity.

| Kind | Who may use it in a route |
|---|---|
| **Bed lift** | beds and trolleys, staff; patients on foot or in wheelchairs |
| **Public lift** | patients on foot or in wheelchairs, visitors, staff |
| **Service / clean / dirty** | supplies and waste flows only |
| **AGV** | automated trolleys only; never a patient route |

For La Plaza we mark the cores by hand from the drawings. The existing reader of lift room names
(`coreKind` in `twin/geometry.ts`) is still used, but only to suggest cores.

### A. Walking routes (navigation network)

**Built per floor from two sources, combined:**
1. **Walkable space**: a 25 cm grid with walls, glass and columns blocked and a clearance band around them. This finds
   corridors and open areas without depending on room outlines touching.
2. **Room connections**: rooms whose outlines share at least ~0.9 m (snap tolerance ~0.5 m) connect. A connection is
   *confirmed* when door linework sits on the shared edge; otherwise it's *assumed* only towards corridors, lobbies,
   waiting areas and alcoves, so a route doesn't cut through a ward room to reach the next one.

A room is on the network if either source reaches it. **Manual fixes** (add an opening, close one) are stored per
floor by position and survive recomputation and re-import.

**Zones.** Each room can carry an access zone, defaulted from its department and name and editable: *public*,
*patient*, *staff only*, *sterile* (theatre suites, airlocks, scrub), *isolation*. A route only passes through zones its
traveller may enter. Through-traffic in a sterile zone is never allowed; it can only be the step's own destination.

**Between floors**: by declared lift cores only (stairs are found as today and checked). Each journey kind may only use
the lifts allowed for it (table in §5 0).

**Cost of a leg**:

| Moving | Pace | Vertical |
|---|---|---|
| On foot | 1.2 m/s | stairs or public/bed lift |
| Wheelchair | 0.8 m/s | lift only |
| Bed or trolley | 0.6 m/s | bed lift only |

Lift time = wait + ride per storey. The wait is a setting per core, with an optional value per hour of day so that
morning peaks show up. Defaults are labelled as assumptions until measured.

**Shortest route**: A\* over the grid, then simplified to a smooth polyline. Because the grid already follows corridors,
we don't build corridor centrelines separately. Routes between rooms are computed on demand. The grid and the
room-to-grid links are cached per hospital and rebuilt when a floor's rooms or linework change.

**Where it's used**: pathway legs (C); "nearest working device", replacing today's straight line and fixed storey cost;
the route from a fault to the technicians' workshop; walk mode.

**Checking it**: a *Routes* layer over a floor shows walkable space, confirmed and assumed connections, manual fixes,
zones, and rooms that can't be reached (listed with a *Fix* button). A coverage figure per floor is shown in the
facility settings. If a route can't be found, the leg is drawn as today's straight line, marked **estimated** in the
pathway card. It never silently looks precise.

**Performance budget**: a floor's grid is about 660 × 650 cells. Building it for all floors takes a few seconds on the
server at load time, and a single route takes tens of milliseconds. In the browser, route drawing runs off the main
thread so the 3D view doesn't stutter.

### B. Pathway editor

**A pathway** (e.g. *Trauma — arrival to ICU*):
- name, hospital, kind (**patient**; later *staff, clean supplies, dirty/waste* for infection-control checks), status
  (*draft* / *published*), version, description, owner;
- **daily volume** (optional) and an **arrival profile**: how the volume spreads over the 24 hours. Defaults per
  pathway type: emergency peaks in the late morning and evening, elective follows the theatre schedule, outpatient
  follows clinic hours. Without a profile, peak load would be understated.

**A step**: label; **where** — a department (any of its rooms) or a specific room, by code; **typical time** there;
**who accompanies** (porter, nurse, doctor); **equipment needed** (device types from the catalogue, e.g. transport
monitor, ventilator); notes. Special steps: *start* (ambulance bay, main entrance, outpatient desk) and *end*
(discharge, transfer, mortuary).

**An arrow** (link): from → to; **share** of patients taking it (branches add up to 100 %); **how they move**
(walking, wheelchair, trolley, bed); **urgency** (routine / urgent; urgent legs flag long routes more strictly); a
condition label ("if CT positive").

**Two ways to edit, one model** (`/flows`, `/flows/[id]`):
1. **List mode (first)**: steps and arrows as two editable tables, with the diagram laid out automatically beside
   them. Quick to build, works on phones, and enough for the starter pathways.
2. **Canvas mode (second)**: add steps, drag them, draw arrows, zoom and pan, snap to grid, select to edit in a side
   panel; positions are saved. Built in-house as an SVG canvas in React, with no new packages.

**Checks while you edit**: unreachable steps; branches not adding up to 100 %; loops with no exit; steps with no place;
a bed or trolley leg with no bed lift on its route; a route through a zone the traveller can't enter; a step room
marked *removed* after a re-import.

**Starter pathways** to copy and edit: emergency trauma; elective surgery (admission → pre-op → theatre → recovery →
ward → discharge); maternity (triage → delivery → postnatal); outpatient to imaging; ICU transfer to CT and back. Each
starter states its sources and assumptions (times, shares, volumes) in its description.

**Versions**: publishing freezes a version, and editing makes a new draft, so analysis and comparisons stay
reproducible. **Export/import** as a JSON file with rooms by code, and a printable pathway sheet.

### C. Pathways in 3D

- A **Pathways** panel: pick one or several published pathways; each gets a colour (from the existing problem-layer
  palette rules so they stay readable in both looks).
- Each arrow is drawn as its real walking route (A), **thicker for more patients**. Lifts and stairs show the vertical
  leg, and step rooms get a numbered marker with the step name. Estimated legs are drawn dashed.
- **Play**: animated patient markers move along the pathway, branching by the shares and pausing at steps for their
  time; speed 10× … 600×; the marker count is capped on slow devices.
- **Pathway card**: total distance, floor changes, lift trips, time moving vs time in care, the longest leg ("ER → CT:
  140 m, 2 floors by bed lift, 3 min"), the number of estimated legs; click a leg to fly to it.
- Combine with problem layers, e.g. pathways over the *Open faults* heat map.

### D. Pathway analysis

All figures show their formula and assumptions on hover, like BOQ quantities do today, and are labelled *estimate*.

| Figure | How it's worked out | Flag |
|---|---|---|
| Patients at a step | daily volume × product of shares along the way | — |
| Room load | patients × minutes at the step ÷ (rooms × open minutes), at the **peak hour** of the arrival profile | > 85 % |
| Beds needed | patients × hours in bed ÷ 24 | above beds in that department |
| Scanner load | exams a day vs capacity from the reviewed reference figures (e.g. 1 CT per 12,000 exams a year) | > 85 % |
| Lift load | lift trips in the peak hour per core vs trips an hour per car (from round-trip time: doors, travel, loading) | > 70 % (waiting rises sharply above this) |
| Corridor traffic | patients a day through each stretch of corridor, across selected pathways (heat layer) | — |

- **Equipment readiness (live)**: for every step, are the needed device types in that room or department, and are they
  working now? ("CT room: scanner out of service → trauma pathway blocked"; "No working transport ventilator on
  floor 4.") Uses the same live data as the 3D status (`twin-live.ts`). Shown on the pathway card and as a risk on the
  dashboard.
- **Compare**: two pathways or two versions side by side (e.g. CT on floor 4 vs a CT next to the ER): distance, time,
  lift trips, load.
- **Clean and dirty routes** (when supply/waste pathways exist): flag corridors and lifts shared by clean and dirty
  flows.
- **Report**: *Pathway analysis* sheet (print/Excel) per hospital, with a worked example in the docs.

Queue simulation (waiting times) stays out of scope; load above the flag levels is the signal to look closer.

### E. Interactive 3D

| Feature | What it does | Notes |
|---|---|---|
| **Drag to move** | Pick up a device and drop it in another room; confirm; *Undo* for 30 s | Needs `assets.move` and the same facility rules as Move. Undo records a reverse move, so history stays complete |
| **Notes in the model** | Drop a note on a room, device or point: text, photo, assignee, status (open/done); *Turn into a work order* | Called *notes*, not pins, because "pins" already means asset markers on the floor map (`lib/assets/pins.ts`). Photos via documents |
| **Live alerts** | A new fault anywhere flashes in the model with a toast; *Go there*; follow a job from report to repair | Uses the existing one-minute refresh (`/assets/3d/live`); push later |
| **Hover cards** | Room/department card: equipment, devices down, open jobs, notes | No new data |
| **Guided tours** | Chain saved views into a presentation with captions and timing; play full screen; share a link | Builds on `twin_views` |
| **Time slider** | Replay the last N days: faults, repairs, moves, installations | Only events that are stored with a time can be replayed; we check which ones are before promising a status replay |
| **Walk mode** | First person on a floor (keyboard, or an on-screen stick on tablets), kept on the walkable space | Needs A |
| **Keyboard shortcuts** | F find, 1–9 floors, L look, R reset, Esc clear | Shown in a `?` overlay; disabled while typing in a field |

### F. Presentation renders

**What we're aiming for**: the furnished "dollhouse" floor images used in hospital presentations (reference: the
Crown Specialized Hospital floor book by HTCO). The view is from above at an angle, walls are cut at about 1.2 m with
solid grey tops, and every room is furnished with beds, theatre lights, incubators, desks and toilets. Floors are
coloured by room type, shadows are soft with darkening in corners, the lighting is warm and the labels are clear. One
image per floor, collected into a short book with a cover.

**Why build it rather than commission it**: the reference images appear to have been made with an AI image tool:
labels are misspelled ("MORTUAKY", "CERERATOR", "Crosk Cort") and floors 4/5 and 6/7 are the same picture. Ours are
generated from the real drawings and the real register, so they are **faithful by construction**: correct room
shapes, correct names, and equipment where it actually is or is planned. They're also regenerated in seconds when
the layout changes.

**What exists today** (release 3.0): light architectural style, low cutaway walls (`CUTAWAY` in `twin/scene.ts`),
camera presets (isometric, plan, eye level), life-size but simple device shapes (`kindGeometry()`: bed, monitor,
ventilator, imaging, pump, cabinet) and *Download image* (`snapshot()`, 2× screen size). F builds on these.

#### F1. Render mode (built in, no outside service)

A **Render** button in the 3D view opens a side panel with settings, a preview and *Render*:

| Setting | Choices |
|---|---|
| View | Dollhouse (top-down at ~60°, as in the reference), isometric, plan, eye level, or the current camera; one floor or all floors |
| Cut height | 1.0–1.5 m (default 1.2 m); wall tops capped in solid grey |
| Equipment shown | **Installed** (register), **Planned** (from a BOQ, via plan vs installed), or both. Planned items are drawn in a lighter tint |
| Furniture | **Room kits** on/off (see below); people figures on/off |
| Labels | Room names, department names, both or none; language (English now, Arabic when the interface is translated) |
| Look | Daylight or warm interior; floor finishes by room type on/off |
| Output | 1080p, 4K or 8K wide; PNG or JPEG; white or transparent background; title block on/off |

**Look and lighting**:
- floors coloured by room type: vinyl in clinical areas, light blue in wet rooms, wood in offices and lounges, darker
  in plant rooms;
- walls extruded with real thickness from the CAD linework, and door leaves drawn open with their swing;
- soft shadows from a sun plus sky light, and ambient occlusion so corners and furniture feet darken;
- tone mapping and a slight vignette.

All of this uses three.js and its bundled example passes (SSAO/GTAO, shadow maps, `GLTFLoader`), so no new npm
packages are needed.

**Room kits (furniture)**: today the model shows only registered devices. The reference images look rich because
every room is furnished, so each room type gets a kit placed automatically inside its outline:

| Room type (from name/type, as the CAD fit-out already does) | Kit |
|---|---|
| Inpatient single/double, ICU bay | bed, bedside cabinet, overbed table, visitor chair, monitor on its arm, ceiling track where shown |
| Operating theatre | table, two surgical lights, pendant, anaesthesia machine, instrument trolleys |
| NICU / SCN | incubators or cots, breast-feeding chair, monitor |
| Imaging (CT, MRI, X-ray, US) | the modality itself, control-room desk behind the glass |
| Clinic / exam | couch, desk and two chairs, sink |
| Nurse station, office, reception | desk run with chairs and screens |
| Waiting area | rows of chairs |
| WC, shower, utility, store | WC and basin, shower tray, sink unit, shelving |
| Lab | benches with analysers, fridge |
| Lift, stair | car interior, stair flights (from the stair outline) |

- Placement reuses the existing in-room spreading (`spreadInRoom`): furniture goes against walls and away from the
  door, and beds face into the room.
- **Registered devices keep their exact spots** and take precedence over kit items of the same kind.
- Kit items are marked **illustrative** on screen and in the title block, and can be switched off to show only real
  equipment.
- Kits live in `seed-data/room-kits.json`, editable like the BOQ standards.
- **Models**: about 40 low-poly furniture and equipment models (glTF, Draco-compressed, about 5 MB in total) under
  `public/models`, from openly licensed (CC0) libraries or made in-house. Licences are checked before anything is
  bundled. Today's primitive shapes stay as the fallback and as the live-view models.

**Making the image**:
- Rendered off screen at full quality, separate from the live view (which keeps its light settings for tablets).
- 4K and 8K are made **in tiles**, so they work beyond the browser's maximum canvas size, then joined.
- A progress bar shows while it renders; it takes seconds, not minutes.
- **Labels are drawn by the app** after rendering, as crisp text with the exact names from the register, placed so
  they don't overlap. They're never part of the 3D image, so they can't come out garbled.
- **Title block** (optional): hospital, floor, date, scale bar, north arrow, *equipment: installed / planned*, and
  *furniture illustrative* when kits are on.

**Floor book**: *Render all floors* with one setting produces a consistent set, collected into a printable book:
- a cover with the hospital name and a whole-building view;
- one page per floor with its render and a short list of departments, filled in from the department names;
- the reference document's layout as the default, and the hospital's logo and colours from settings.

Output is print-to-PDF like the other printable sheets, plus a ZIP of the PNGs. The render settings are saved with
the saved view (`twin_views`), so a book can be remade after changes with one click.

**Uses**:
- tender and client presentations, showing proposed equipment in the client's own rooms from the BOQ;
- board papers on what a refurbishment will look like;
- commissioning: what's installed where;
- way-finding images for staff orientation.

#### F2. AI finish (optional, later)

An optional extra pass sends the faithful render to an image-generation service to add photographic materials and
lighting. It uses depth and edge images so walls, rooms and equipment stay where they are. The app then puts its own
labels and title block back on top.

| Point | Rule |
|---|---|
| Off by default | Switched on by an administrator; the hospital decides whether drawings may leave the server |
| Honest output | Every image marked *AI-enhanced, illustrative*; shown side by side with the faithful render before saving; one click to reject |
| Text | Never generated by the AI; labels always come from the app |
| Cost | Per image, shown before running; a monthly limit in settings |

F2 is in the Could column: F1 alone already gives the look of the reference with correct content.

**Not in F**: exterior (façade) renders. The drawings we import are floor plans only, so a faithful exterior needs
elevations or a building model (BIM, see §10).

## 6. Data model (new)

| Table | Holds |
|---|---|
| `lift_cores` | facility, position, kind (bed/public/service/AGV), floors served, car capacity, wait settings |
| `route_fixes` | floor, position, add or close an opening, author, note |
| `room_zones` | room, access zone (or a `zone` column on `rooms`) |
| `patient_flows` | pathway: hospital, name, kind, status, version, parent version, daily volume, arrival profile, description, owner |
| `flow_steps` | pathway, label, kind (start/step/end), department, or floor code + room code, minutes, accompanying, required device types, x/y on the canvas |
| `flow_links` | pathway, from step, to step, share %, transport, urgency, condition |
| `twin_notes` | hospital, room or device (or point), position, text, status, assignee, author, work order link |
| `twin_tours` | hospital, name, shared, ordered list of saved views with captions and timing |
| `twin_views` (existing, extended) | a `render` settings column (view, cut height, equipment source, kits, labels, look, output) |
| `room_kits` | reference data from `seed-data/room-kits.json`: room-type rule → furniture items and quantities, editable by planners and biomedical engineers |

The walkable grid and room links are derived and cached, not edited. Rendered images aren't stored by default. They
can be saved to a hospital's documents when the person rendering chooses to.

**Permissions**: new `flows.edit` for administrator, biomedical engineer and BOQ planner. Everyone with `assets.view`
sees published pathways and can add notes. Notes are closed by their author, their assignee or anyone with
`assets.edit`. Lift cores, zones and route fixes need `facilities.edit`.

## 7. Phases

| Step | Deliverable | Checks before done | Size |
|---|---|---|---|
| **7-0** | In-place re-import with review screen; rooms referenced by code; lift core editor; La Plaza cores marked | Re-import of an edited La Plaza floor keeps assets and shows a correct change list; unit tests for the merge | M |
| **7a** | Walking routes (grid + room links + fixes + zones), Routes layer and coverage figure; nearest device uses it; **one hard-coded trauma pathway drawn in 3D** as an early look | Unit tests for the network and A\*; La Plaza coverage ≥ 98 % after fixes; the 20-route review; lift legs use allowed cores only | M–L |
| **7b** | Pathway editor in **list mode**: tables, checks, starter pathways, versions, export/import | Unit tests for checks and shares; browser test creating a pathway end to end; phone width | M |
| **7c** | Pathways in 3D: routes, markers, play, pathway card; **equipment readiness** | Browser test: pick a pathway, play, card figures match a hand calculation; readiness flips within one refresh | M |
| **7d** | Rest of analysis: load with arrival profiles, lifts, corridor heat, compare, report | Unit tests for every figure; worked example in the docs | M |
| **7e** | Canvas mode; drag to move; notes; live alerts; hover cards | Browser tests per feature; all earlier 3D tests still pass | M–L |
| **7f** | Guided tours, time slider, walk mode, shortcuts; docs and README | Browser tests; docs updated | M |
| **7g** | Presentation renders F1: render panel, room kits and models, lighting and materials, tiled 4K/8K export, app-drawn labels and title block, floor book | Visual review of every La Plaza floor against the reference look; label text checked against the register; 4K timing on a laptop; model licences listed in the docs | M–L |
| **7h** | F2 AI finish (if approved) | Side-by-side review; geometry and labels unchanged; off by default | S–M |

The early look in 7a puts a real route in front of you before the editor is built, so the routing can be corrected
while it's still cheap to change.

Each step ends like the earlier waves: tests, a crawl of every page per role, commit and push to the branch, and your OK
before it goes to `main`.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Routes look exact but rest on gappy drawings | Two-source network, manual fixes, coverage gate in 7a, estimated legs drawn dashed and counted on the card |
| Lifts unknown or wrong kind (e.g. a route through an AGV lift) | Declared lift cores with kinds; journey kinds limited to allowed lifts; check in the editor |
| Revised drawings break pathways | In-place re-import (7-0); rooms by code; *removed* rooms flagged on affected steps |
| Routes through sterile or staff-only areas | Zones with sensible defaults, editable; checked in the 20-route review |
| Volumes, times and lift waits are estimates | Labelled assumptions with sources; arrival profiles; later read real volumes from the hospital information system |
| Animating many patients on weak tablets | Cap markers, simplify on slow devices (as today); route work off the main thread |
| Scope: six steps of M–L | Cut line in §4; Must items first; Could items move to wave 8 without blocking anything |
| Renders mistaken for the real fit-out | Kit furniture labelled *illustrative*; planned equipment tinted; title block says what's shown |
| Furniture models' licences | CC0 or in-house models only; licence list in the docs |
| Large renders crash weak machines | Tiled rendering; 8K offered only on capable devices; the live view keeps its light settings |
| AI finish invents objects or exposes drawings | F2 off by default, administrator switch, side-by-side approval, labels never AI-made |

## 9. Decisions needed from you

| Question | My suggestion |
|---|---|
| First pathways to model? | Emergency trauma and elective surgery first; maternity and outpatient imaging next |
| Who edits pathways? | Administrator, biomedical engineer, BOQ planner. Department heads are read-only everywhere today, and users are limited by facility, not department, so department-head editing would be a new kind of permission. Suggest wave 8 |
| Who marks lift cores, zones and route fixes? | Biomedical engineers (they already hold `facilities.edit`) |
| A leg with no route found: allow it as estimated, or block publishing? | Allow it as estimated, shown dashed and counted on the card; block only bed legs with no bed lift |
| Analysis depth now? | Distances, times and readiness first (7a–7c), then load (7d) |
| Other flows (staff, supplies, waste)? | Keep the model ready (kinds, service lifts); add the clean/dirty check after patient pathways work |
| Order of interactive features? | Drag to move, notes, live alerts first; tours, time slider, walk mode after |
| When do you need renders? | If for an upcoming client or tender, build 7g first (it doesn't depend on routes) |
| Default render look? | The reference's dollhouse look: top-down at ~60°, 1.2 m cut, warm interior, labels on |
| Furniture models: free libraries or commissioned? | Start with CC0 libraries plus a few in-house models for medical equipment; commission later if the look needs it |
| AI finish (F2)? | Not now; decide after seeing F1 renders of La Plaza |

## 10. Later (not this wave)

Real-time location tags, real volumes and waiting times from the hospital information system, queue simulation,
department-scoped editing, building services (MEP) layers, BIM (IFC) import, Arabic interface.

## 11. Appendix — how the drawing checks in §3 were run

Scripts run on `seed-data/cad/la-plaza.json`. They're not part of the app, and their numbers are a lower bound for what
the real implementation should reach.
- *Touching outlines*: room polygons buffered by 0.5 m; a link where the overlap is ≥ 0.9 m long; confirmed by door
  segments crossing the overlap, otherwise assumed only when one side is a corridor/lobby/waiting/reception/alcove; main
  network = the component holding most corridors; technical rooms (electrical, HVAC, shafts, data, toilets) excluded.
- *Walkable space*: walls, glass and columns rasterised on a 25 cm grid and dilated by one cell; main region = the one
  holding most corridor label points; a room counts as reached when its label point is in that region.

## 12. What changed

**Revision 3**
- Added **Part F, presentation renders**: a render mode for furnished, photo-style dollhouse floor images, with room
  kits, real wall thickness, materials, soft shadows and ambient occlusion. It covers installed or planned (BOQ)
  equipment, tiled 4K/8K export, labels and title block drawn by the app, and a printable floor book. An optional,
  off-by-default AI finish (F2) is included.
- Steps **7g** and **7h**, new goal 4, render target in §1, cut-line placement, data model, risks and decisions
  updated to match.

**Revision 2**

- Added **§3, what the drawings can give us**, from tests on the La Plaza data: lifts aren't named on 8 of 9 floors,
  and touching outlines reach only 66 % of rooms.
- Added **groundwork (7-0)**: in-place drawing re-import, rooms by code, and declared lift cores with kinds (bed /
  public / service / AGV).
- **Routes** now combine walkable space from the wall lines with room connections, plus manual fixes, **access zones**
  and per-hour lift waits. A\* on the grid replaces Dijkstra on room centres and corridor centrelines.
  Estimated legs are always visible as such.
- Added **success measures** (§1), a **cut line** (§4) and a **performance budget**.
- **Editor**: list mode first and canvas second; **arrival profiles** so peak load isn't understated.
- **Analysis** formulas spelled out, including lift capacity, with flag levels.
- **Pins → notes** (`twin_notes`), so they don't clash with the floor map's asset pins. Drag to move respects
  `assets.move` and undoes by a reverse move.
- **Permissions** aligned with the existing roles. Department-head editing is moved to later, with the reason.
- **Phases** reordered, with an early trauma route in 3D in 7a.
