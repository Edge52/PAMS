# Wave 7 plan — interactive 3D and patient flows

Status: **draft for discussion** · 1 Nov 2026

## 1. Goals

1. Let you describe **how patients move through the hospital** (and, later, staff, supplies and waste) as pathways you
   draw yourself, and see them **in the building**, with distances, floor changes, timings and load.
2. Make the 3D view **a place you work in**, not only look at: drag things, leave notes, present, get live alerts.
3. Give planning answers you can't get today: *"Is the CT in the right place for trauma patients?"*, *"Which lift is the
   bottleneck at 10 am?"*, *"Is everything this pathway needs actually working right now?"*

## 2. Where the 3D view stands (release 3.0)

| Strong today | Gap this wave closes |
|---|---|
| Whole building from the drawings, lifts and stairs, façade, two looks | Shows **equipment only**, nothing about people or process |
| Live status, problem heat maps, plan vs installed | Routes are **straight lines through walls** plus a fixed cost per floor |
| Act on devices through the side panel (fault, move, exact spot) | Interaction goes **through forms**; no drag and drop, no notes in the model |
| Saved views, presets, section cut | **No time dimension** (replay), **no guided presentation**, orbit-only navigation |

## 3. What we'll build — overview

| Part | What you get | Depends on |
|---|---|---|
| **A. Walking routes** | Real routes along corridors, through rooms' doors, by lift or stairs; used everywhere a route is drawn | — |
| **B. Pathway editor** | Draw a patient pathway as boxes and arrows, tie steps to departments or rooms, add times, transport, equipment and volumes | — |
| **C. Pathways in 3D** | The pathway drawn through the building, animated patients, distances and times per leg | A, B |
| **D. Pathway analysis** | Load on rooms, equipment, lifts and corridors from daily volumes; bottlenecks; equipment readiness; compare versions | C |
| **E. Interactive 3D** | Drag to move, pins and notes, guided tours, live alerts, hover cards, time slider, walk mode | A (for walk mode) |

## 4. Design

### A. Walking routes (navigation network)

**Built from the drawings, per floor:**
- **Places**: every room (corridors, lobbies and waiting areas included) is a node at its inside point.
- **Connections**: two rooms connect when their outlines touch along at least ~0.9 m (a door's width). A connection is
  *confirmed* when door lines from the drawing sit on the shared edge, otherwise *assumed* — rooms then open onto
  corridors and lobbies only, so a route doesn't cut through a ward room to reach the next one.
- **Between floors**: lifts and stairs (found from room names, as today) connect to the same core on the floors above
  and below, matched by position.
- **Cost of a leg**: distance at walking pace (1.2 m/s on foot, 0.8 m/s with a wheelchair, 0.6 m/s with a bed or trolley);
  lift = wait + ride per storey; stairs only on foot. Bed and trolley journeys may only use lifts.
- **Shortest route**: Dijkstra over this network; the line drawn follows corridor centrelines through the shared edges.

**Where it's used**: pathway legs (C), "nearest working device" (replaces today's straight line), the route from a
fault report to the technician's workshop, and walk mode.

**Checking it**: a *Routes* debug layer shows the network over a floor (confirmed vs assumed connections, rooms that
can't be reached) so we can fix the drawing import where needed. If a floor's drawing is too incomplete, the route
falls back to today's straight line with a warning.

**Stored**: computed from rooms and linework when a building is loaded or a room changes; cached per hospital (no
manual upkeep).

### B. Pathway editor

**A pathway** (e.g. *Trauma — arrival to ICU*):
- name, hospital, kind (**patient**; later *staff, clean supplies, dirty/waste* for infection-control checks), status
  (*draft* / *published*), version, description, **daily volume** (optional), owner.

**A step** (box): label; **where** — a department (any of its rooms) or a specific room; **typical time** there;
**who accompanies** (porter, nurse, doctor); **equipment needed** (device types, e.g. transport monitor, ventilator);
notes. Special steps: *start* (arrival — ambulance bay, main entrance, outpatient desk) and *end* (discharge, transfer, mortuary).

**An arrow** (link): from → to; **share** of patients taking it (branches add up to 100 %); **how they move**
(walking, wheelchair, trolley, bed); **urgency** (routine / urgent — urgent legs flag long routes more strictly); a
condition label ("if CT positive").

**Editor screen** (`/flows`, `/flows/[id]`):
- Canvas: add steps, drag them, draw arrows between them, zoom and pan; snap to grid; select to edit in a side panel.
- Side panel: the step's or arrow's fields; pick the department or room from the hospital's list (or click it in a
  small 3D preview).
- Checks while you draw: unreachable steps, branches not adding up to 100 %, loops without exit, steps with no place,
  bed transport on a route with no lift.
- **Starter pathways** to copy and edit: emergency trauma; elective surgery (admission → pre-op → theatre → recovery
  → ward → discharge); maternity (triage → delivery → postnatal); outpatient to imaging; ICU transfer to CT and back.
- Versions: publishing freezes a version; editing makes a new draft, so analysis and comparisons stay reproducible.
- Export and import as a file (JSON), and a printable pathway sheet (PDF via print).
- Built in-house (SVG canvas in React), no new packages.

### C. Pathways in 3D

- A **Pathways** panel: pick one or several published pathways; each gets a colour.
- Each arrow is drawn as its real walking route (A), **thicker for more patients**; lifts and stairs show the vertical
  leg; step rooms get a numbered marker with the step name.
- **Play**: animated patient markers move along the pathway, branching by the shares, pausing at steps for their time
  (speed control: 10× … 600×).
- **Pathway card**: total distance, floor changes, lift trips, time moving vs time in care, the longest leg
  ("ER → CT: 140 m, 2 floors by lift, 3 min"), with a click to fly to it.
- Combine with problem layers: e.g. pathways over the *Open faults* heat map.

### D. Pathway analysis

From the daily volume and shares:
- **Load per step**: patients a day at each step → room-hours used vs available (open hours × rooms), beds needed
  (patients × hours in bed ÷ 24), scans a day vs scanner capacity (reviewed reference figures, e.g. 12,000 CT exams a
  year). Flags over 85 % load.
- **Lifts**: lift trips per hour per lift core (volumes spread over opening hours) vs a lift's trips an hour.
- **Corridors**: a heat layer of how many patients a day pass through each corridor, across all selected pathways.
- **Equipment readiness (live)**: for every step, are the needed device types in that room or department, and working
  now? ("CT room: scanner out of service → trauma pathway blocked"; "No working transport ventilator on floor 4.")
  Shown on the pathway card and as a risk on the dashboard.
- **Compare**: two pathways or two versions side by side (e.g. CT on floor 4 vs a CT next to the ER) — distance, time,
  lift trips, load.
- **Clean and dirty routes** (when supply/waste pathways exist): flag corridors and lifts shared by clean and dirty
  flows.
- Report: *Pathway analysis* sheet (print/Excel) per hospital.

### E. Interactive 3D

| Feature | What it does | Notes |
|---|---|---|
| **Drag to move** | Pick up a device and drop it in another room; confirm; undo for 30 s | Same rules and history as Move |
| **Pins and notes** | Drop a pin on a room or device: note, photo, assignee, status (open/done); everyone with access sees it; *Turn into a work order* | New table; attachments via documents |
| **Guided tours** | Chain saved views into a presentation with captions; play full screen; share a link | Builds on saved views |
| **Live alerts** | A fault reported anywhere flashes in the model with a toast; *Go there*; follow a job from report to repair | Uses the minute refresh (later: push) |
| **Hover cards** | Room/department card: equipment, devices down, open jobs, pins | No new data |
| **Time slider** | Replay the last N days: faults, repairs, moves, installations | From work orders, movements, activity |
| **Walk mode** | First-person on a floor (keyboard, or on-screen stick on tablets), along the route network | Needs A |
| **Keyboard shortcuts** | F find, 1–9 floors, L look, R reset, Esc clear | — |

## 5. Data model (new)

| Table | Holds |
|---|---|
| `patient_flows` | pathway: hospital, name, kind, status, version, parent version, daily volume, description, owner |
| `flow_steps` | pathway, label, kind (start/step/end), department or room, minutes, accompanying, required device types, x/y on the canvas |
| `flow_links` | pathway, from step, to step, share %, transport, urgency, condition |
| `twin_pins` | hospital, room or device, position, note, status, assignee, author, work order link |
| `twin_tours` | hospital, name, shared, ordered list of saved views with captions and timing |

The route network is derived (cached), not edited. Permissions: new `flows.edit` (admin, biomedical, planner; your
choice for department heads); everyone with `assets.view` can see published pathways; pins by anyone with
`assets.view`, closing them by the author, the assignee or the biomedical team.

## 6. Phases

| Step | Deliverable | Checks before done | Size |
|---|---|---|---|
| **7a** | Route network + routes in 3D (nearest device uses it) + Routes debug layer | Unit tests for the network and Dijkstra; La Plaza: every non-technical room reachable on each floor, routes avoid walls (visual check), lift legs correct | M |
| **7b** | Pathway editor: tables, list, editor canvas, side panel, checks, starter pathways, versions, export/import | Unit tests for checks and shares; browser test drawing a pathway end to end; phone width | M–L |
| **7c** | Pathways in 3D: routes, markers, play, pathway card | Browser test: pick a pathway, play, card figures match a hand calculation | M |
| **7d** | Analysis: load, lifts, corridor heat, equipment readiness, compare, report | Unit tests for every figure; a worked example in the docs | M |
| **7e** | Interactive 3D: drag to move, pins and notes, live alerts, hover cards, guided tours | Browser tests per feature; all earlier 3D tests still pass | M–L |
| **7f** | Time slider, walk mode, shortcuts; docs and README | Browser tests; docs updated | M |

Each step ends like the earlier waves: tests, a crawl of every page per role, commit and push to the branch, and your OK
before it goes to `main`.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Doors in the drawings are only lines, not clean openings | Connect rooms by shared edges; doors confirm, corridors/lobbies assumed open; debug layer to spot gaps; fall back to straight lines with a warning |
| Some rooms in the drawings don't touch their corridor (gaps in the outlines) | Snap tolerance (~0.5 m); list unreachable rooms so they can be fixed in the CAD import |
| Animating many patients on weak tablets | Cap markers, simplify on slow devices (as today) |
| Volumes are estimates until real data exists | Clearly labelled assumptions; later read real volumes from the hospital information system |

## 8. Decisions needed from you

| Question | My suggestion |
|---|---|
| First pathways to model? | Emergency trauma and elective surgery first; maternity and outpatient imaging next |
| Who edits pathways? | Admin, biomedical, planner; department heads for their own department's pathways |
| Analysis depth now? | Distances and times first (7a–7c), then load and readiness (7d) |
| Other flows (staff, supplies, waste)? | Keep the model ready for them; add the clean/dirty check after patient pathways work |
| Order of interactive features? | Drag to move, pins and notes, live alerts first; tours, time slider, walk mode after |

## 9. Later (not this wave)

Real-time location tags, real volumes from the hospital information system, queue simulation (waiting times),
building services (MEP) layers, BIM (IFC) import, Arabic interface.
