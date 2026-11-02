# Changelog

## Unreleased — wave 7 (in progress, branch `wave-7`)

Migrations `0016`–`0018`. Update with `git pull` and `npm run demo`; your data is kept.

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
