# Hospital PAMS — team conventions

Hospital procurement, BOQ and medical asset management system. Built by a lead plus module agents working
**in the same working tree at the same time**. These rules keep us from stepping on each other.

## Stack
- Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4
- PostgreSQL 16 via Drizzle ORM (`src/db/schema.ts`, client `db` from `@/db`)
- Vitest for unit tests of pure logic
- Pre-installed libs you may use: `zod`, `exceljs` (Excel export), `qrcode` (asset tag QR codes). **Do not run `npm install`.**
  If you truly need another package, stop and say so in your report.

## Next.js 16 specifics (read this — they bite)
- Next 16 differs from older versions. When unsure about an API, check the bundled docs in `node_modules/next/dist/docs/` before guessing.
- `params` and `searchParams` in pages/layouts are **Promises**: `export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; }`
- Pages are Server Components by default. Read data directly with `db` in the page. Add `export const dynamic = "force-dynamic";` to every page that reads the database.
- Mutations: server actions in a colocated `actions.ts` with `"use server"` at the top. Validate with zod, write with `db`,
  call `logActivity(...)` from `@/lib/server-utils`, then `revalidatePath(...)` and/or `redirect(...)`.
- Use `"use client"` only for genuinely interactive pieces (floor map drag, live calculators, comparison toggles). Keep them small and pass data in as props.
- Forms: plain `<form action={serverAction}>` with named inputs works without client JS — prefer it.

## Ownership (do not edit files you don't own)
| Owner | Files |
|---|---|
| Lead | `src/db/**`, `src/components/ui/**`, `src/components/side-nav.tsx`, `src/lib/format.ts`, `src/lib/status.ts`, `src/lib/server-utils.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `scripts/seed.ts`, `scripts/seed/facility.ts`, `seed-data/department-types.json`, `package.json`, configs |
| Procurement agent | `src/app/procurement/**`, `src/lib/procurement/**`, `src/components/procurement/**`, `scripts/seed/procurement.ts` |
| BOQ agent | `src/app/boq/**`, `src/lib/boq/**`, `src/components/boq/**`, `scripts/seed/boq.ts` |
| Assets agent | `src/app/assets/**`, `src/app/facilities/**`, `src/app/catalogue/**`, `src/lib/assets/**`, `src/components/assets/**`, `scripts/seed/assets.ts` |
| Taxonomy research agent | `seed-data/device-taxonomy.json`, `docs/taxonomy.md` |
| Standards research agent | `seed-data/boq-standards.json`, `docs/boq-standards.md` |

Need a schema change or a shared helper? **Don't edit lead files** — work around it inside your module and list the
request in your final report with the exact change you want.

## Shared seams (lead-owned — use them, don't duplicate them)
- **Creating assets**: always `createAsset()` / `createAssets()` from `@/lib/asset-factory`. It generates the tag
  (`DGH-MON-000042`), inherits department from room, fills criticality/life from the device type, computes warranty end and logs it.
  Procurement goods receipt and the asset register both go through it.
- **Attachments**: `<DocumentsPanel entityType="offer" entityId={id} returnPath={`/procurement/offers/${id}`} />`
  from `@/components/documents-panel` (entity types: offer, po, asset, spec, supplier, project, delivery, boq, rfq).
- **Activity trail**: `logActivity(entityType, id, action, summary)` and `getActivity(entityType, id)` from `@/lib/server-utils`.
- **FX**: `convert(amount, from, to)` / `rateToEgp()` from `@/lib/server-utils` (rates in `exchange_rates`).

## Cross-module route contracts (build yours to these exact URLs so links between modules work)
| URL | Owner | Purpose |
|---|---|---|
| `/procurement/[projectId]` | procurement | project / tender detail |
| `/procurement/rfqs/new?projectId=&boqId=` | procurement | new RFQ, lines pre-filled from a BOQ when `boqId` is given |
| `/procurement/offers/[id]`, `/procurement/purchase-orders/[id]` | procurement | detail pages |
| `/procurement/suppliers/[id]` | procurement | supplier detail |
| `/boq/[id]` | boq | BOQ detail; `/boq/[id]/export` returns the .xlsx |
| `/catalogue/[code]` | assets | device type detail (e.g. `/catalogue/MON-PAT-HIGH`) |
| `/assets/[id]` | assets | asset detail |
| `/assets?poId=&departmentId=&roomId=&deviceType=&status=` | assets | register, filterable by these params |
| `/assets/map?floorId=&roomId=&assetId=` | assets | floor map, focused on a floor/room/asset |
| `/facilities/[id]` | assets | facility detail with buildings, floors, departments, rooms |

## Routes (links already exist in the side nav)
- Procurement: `/procurement` (projects & tenders), `/procurement/suppliers`, `/procurement/offers`, `/procurement/purchase-orders`
- BOQ: `/boq`, `/boq/standards`
- Assets: `/assets`, `/assets/map`, `/assets/maintenance`, plus `/facilities` and `/catalogue`

## UI rules
- Import primitives from `@/components/ui`: `PageHeader, Panel, Stat, EmptyState, Button, LinkButton, Field, Input, Textarea, Select, FormGrid, Table, THead, Th, Td, Badge, StatusBadge, Details, TabLinks`.
- Colours only through tokens (`bg-surface`, `text-muted`, `border-line`, `bg-primary`, `text-primary-strong`, `bg-tag`, `text-ok`/`warn`/`danger`/`info` and their `-soft` backgrounds). No raw hex values in module code.
- `bg-tag` (amber) is reserved for asset location pins and highlights.
- Sentence case everywhere. No ALL-CAPS labels. Buttons say what they do ("Create purchase order", not "Submit").
- Empty states tell the user what to do next and offer the action.
- Numbers: use `formatMoney`, `formatNumber`, `formatDate` from `@/lib/format`; numerics come back from Postgres as strings — use `num()`.
- Must work at phone width (tables scroll horizontally inside `Table`).
- Arabic names (`nameAr`) render with `lang="ar" dir="rtl"` on the element.

## Data rules
- Money columns are `numeric(14,2)` → strings. Write them as strings (`String(n)`); compute with `num()`/`lineTotal()`.
- Device types: level 3 rows are the real device types used everywhere (BOQ lines, specs, offers, POs, assets). Levels 1–2 are categories for grouping/filtering.
- `seed-data/core-device-codes.json` lists codes guaranteed to exist — use only these in demo seeds.
- Document numbers: `nextNumber("PO", purchaseOrders, purchaseOrders.number)` → `PO-2026-0001`.

## Your database (each agent has its own — never touch another's)
| Agent | DATABASE_URL |
|---|---|
| Procurement | `postgres://postgres@localhost:5433/hpams_procurement` |
| BOQ | `postgres://postgres@localhost:5433/hpams_boq` |
| Assets | `postgres://postgres@localhost:5433/hpams_assets` |
Reset + seed yours: `DATABASE_URL=<yours> npm run db:reset -- --only=facility,<your seeds>`
(Seeds: export `default async function seed(db: DB)` from `scripts/seed/<name>.ts`; run order is facility → boq → procurement → assets.
Make your seed tolerate missing data from other modules, e.g. skip linking if no BOQ exists.)

## Verifying your work (all required before you report done)
1. `npx tsc --noEmit` — zero errors in your files (ignore errors in another agent's in-progress files, but mention them).
2. `npx eslint <your folders>` — clean.
3. `npx vitest run src/lib/<module>` — unit tests for your pure logic (calculations, scoring, numbering, parsing).
4. Run a dev server on **your port with your own build dir and DB**:
   `DATABASE_URL=<yours> NEXT_DIST_DIR=.next-<module> npx next dev -p <port>` (procurement 3101, boq 3102, assets 3103),
   run it in the background, then `curl` every page you built and check for HTTP 200 and no errors in the server log.
   Exercise at least one create flow per entity by POSTing through the real form or by calling the action in a tsx script.
5. **Never run `next build`** (it collides with other agents). The lead runs the production build at integration.
6. Stop your dev server before you finish.

---

# Release 2.1 additions (read this too)

## Sign-in and permissions — required in every page, action and route you touch
- `import { requirePermission, requireUser, requireFacilityAccess, facilityScope, getCurrentUser } from "@/lib/auth/session"`.
- **Every page**: first line `await requirePermission("<module>.view")` (`boq.view`, `procurement.view`, `assets.view`, `reports.view`).
- **Every server action**: first line `const me = await requirePermission("<perm>")` with the most specific permission from
  `src/lib/auth/permissions.ts` (`boq.edit`, `offers.edit`, `po.create`, `assets.move`, `maintenance.edit`, …). Never trust a
  hidden form field for who the user is — use `me`.
- **Facility access**: when a record has a facility, call `await requireFacilityAccess(record.facilityId, me)` before
  showing or changing it. List queries filter by `const scope = await facilityScope(me)` (`null` = all facilities, otherwise
  an id list; empty list = nothing).
- **Hide what the user can't do**: `can(me.role, "po.create")` from `@/lib/auth/permissions` decides whether to render a
  button. Hiding is courtesy; the action check is the rule.
- Route handlers use `routeGuard("<perm>")` from `@/lib/auth/route-guard` (already added to the existing ones).
- `logActivity` now records the signed-in user automatically — drop any hard-coded actor names.
- Shared form helpers: `ActionForm`, `SubmitButton`, `FormMessages` now live in `@/components/ui/action-form`
  (the old procurement path re-exports them).
- Admin-editable settings: `getSettings()` / `getSetting(key)` / `setSetting()` from `@/lib/settings` (Law 182 thresholds,
  quorum, alert windows, email switch).

## Demo accounts (password `demo1234`, listed on /login in the demo)
admin@, director@, procurement@, finance@, planner@, biomedical@, technician@, icu@ (department head), legal@ and
viewer@ — all `@demo.hpams`. Seeded by `scripts/seed/users.ts`. Your dev DB: run
`DATABASE_URL=<yours> npm run db:reset -- --only=users,facility,<your seeds>` to get them.
To test as a user in a script, sign in through `/login` with Playwright (see the lead's `auth-smoke.cjs` pattern) — there is
no auth bypass.

## Notifications seam (lead stub, finished by the notifications agent)
`notifyUsers(userIds, {kind, title, body?, href?, dedupeKey?})`, `notifyRole(role, n, facilityId?)`, `usersWithRole(role, facilityId?)`
from `@/lib/notifications`. Approvals and alerts call these; don't write to the `notifications` table directly.

## Ownership for 2.1 (do not edit files you don't own; ask the lead)
| Owner | Files |
|---|---|
| Lead | everything not listed below, incl. `src/db/**`, `src/lib/auth/**`, `src/lib/settings.ts`, `src/app/login|setup|account|forbidden|admin/users/**`, `src/app/page.tsx`, layout, side nav, top bar, `scripts/seed.ts`, `scripts/seed/users.ts`, Docker/hosting files, README |
| Approvals agent | `src/lib/approvals/**`, `src/app/approvals/**`, `src/app/admin/settings/**`, `src/components/approvals/**`, and the procurement + BOQ module files (`src/app/procurement/**`, `src/lib/procurement/**`, `src/components/procurement/**`, `src/app/boq/**`, `src/lib/boq/**`, `src/components/boq/**`, `scripts/seed/procurement.ts`, `scripts/seed/boq.ts`, `scripts/seed/approvals.ts`) |
| Notifications & reports agent | `src/lib/notifications/**`, `src/app/notifications/**`, `src/components/notification-bell.tsx`, `src/app/reports/**`, `src/lib/reports/**`, `src/components/reports/**`, `src/instrumentation.ts` |
| Assets agent | `src/app/assets/**`, `src/app/facilities/**`, `src/app/catalogue/**`, `src/lib/assets/**`, `src/components/assets/**`, `scripts/seed/assets.ts`, `scripts/seed/cad.ts` |

Schema is final for 2.1 (migration `0005_release_2_1`). Need a column? Ask the lead with the exact change.

## Databases and ports for 2.1
| Agent | DATABASE_URL | Dev port / dist dir |
|---|---|---|
| Approvals | `postgres://postgres@localhost:5433/hpams_procurement` | 3101 / `.next-approvals` |
| Notifications & reports | `postgres://postgres@localhost:5433/hpams_review` | 3104 / `.next-notify` |
| Assets | `postgres://postgres@localhost:5433/hpams_assets` | 3103 / `.next-assets` |
Run `DATABASE_URL=<yours> npx tsx scripts/migrate.ts` first (adds the 2.1 tables).

---

# Wave 3 additions

## Work orders (biomedical package, step 1)
- Routes: `/assets/work-orders` (list + KPIs), `/assets/work-orders/new?assetId=|tag=` (report a fault, phone friendly; the QR label
  opens `/assets/[id]`, which has a "Report a fault" button), `/assets/work-orders/[id]` (detail and every step).
- Table `work_orders` (migration `0007_wave3_work_orders`). Rules are pure in `src/lib/assets/work-orders.ts` (status flow, who may
  do what, response targets, downtime, KPIs, asset status effects); DB helpers in `src/lib/assets/work-order-server.ts`.
- Permissions: `workorders.report` (every role), `workorders.assign` (admin, biomedical). Working a job needs `maintenance.edit`.
- Completing a job writes a `maintenance_events` row, so maintenance history and PPM due dates stay in one place.
- Attachments: entity type `work_order` (edit needs `maintenance.edit`). Activity entity type `work_order`.
- **Inside a transaction always pass the actor to `logActivity(..., me.name, tx)`.** Without it, `logActivity` looks up the signed-in
  user through the global `db`, which deadlocks on PGlite's single connection.

## PPM checklists and service contracts (biomedical package, step 2a)
- Checklists: `device_types.ppm_checklist` (type → group → category → built-in default by taxonomy code); pure rules in
  `src/lib/assets/checklists.ts`; edited on `/catalogue/[code]` (`catalogue.edit`). Text form: `description | unit | min | max`.
- PPM jobs: `createPpmWorkOrdersAction` turns scheduled visits into work orders (`work_orders.planned_event_id`, unique). The job
  carries a copy of the checklist; completing it fills the checklist (`ck_result_<i>`, `ck_value_<i>`, `ck_note_<i>`) and
  completes the visit; reopening puts the visit back to scheduled; cancelling releases it.
- Contracts: `service_contracts` + `service_contract_assets`, routes `/assets/contracts`, `/assets/contracts/new`,
  `/assets/contracts/[id]`, permission `contracts.edit` (admin, biomedical, procurement), attachments entity `contract`.
- Cover: `coverOn()` in `src/lib/assets/contracts.ts` — warranty first, then the running contract. Stored on each work order
  (`coverage`, `contract_id`) with `claim_status` / `claim_reference`. Alert `contract_ending` 60 days ahead.

## Spare parts and recalls (biomedical package, step 2b)
- Parts: `spare_parts` (stock per hospital, unique part number per hospital) + `part_transactions` (signed quantities).
  Stock changes **only** through `applyMovement()` in `src/lib/assets/parts-server.ts` (atomic, never below zero). Pure rules in
  `src/lib/assets/parts.ts`. Routes `/assets/parts`, `/assets/parts/new`, `/assets/parts/[id]`; permission `parts.edit` (admin,
  biomedical). Technicians book parts to jobs on the work order page (`maintenance.edit`); cost totals on the job.
  Notification `part_low_stock` when a movement crosses the minimum.
- Recalls: `recalls` + `recall_assets` (FSCA-YYYY-NNNN). Matching in `src/lib/assets/recalls.ts` (type, manufacturer, model,
  serial list — every given criterion must match). Routes `/assets/recalls`, `/assets/recalls/new`, `/assets/recalls/[id]`;
  permission `recalls.edit` (admin, biomedical). Recall jobs are INSPECTION work orders linked via `recall_assets.work_order_id`;
  completing marks the device ACTIONED, reopening puts it back to PENDING, cancelling unlinks it.

## Disposal, replacement plan and device KPIs (biomedical package, step 2c)
- Disposal: `disposals` (DSP-YYYY-NNNN), routes `/assets/disposals`, `/assets/disposals/new?assetId=`, `/assets/disposals/[id]`;
  permission `assets.dispose` (admin, biomedical). Approval goes through the approvals engine as entity `DISPOSAL` (default rule:
  director; editable under Approval rules). Approval effect: asset OUT_OF_SERVICE + CONDEMNED. Recording the disposal needs no open
  work orders and sets the asset DISPOSED; pending recall rows become NOT_AFFECTED.
- Device KPIs and replacement score: pure in `src/lib/assets/lifecycle-kpis.ts`, DB side in `src/lib/assets/lifecycle-server.ts`
  (money converted to EGP with stored rates). Shown on the asset page ("Performance and cost").
- Replacement plan `/assets/replacement` → `createReplacementBoqAction` (`boq.edit`) makes a draft BOQ on the rule-less standard set
  `HPAMS-REPLACEMENT`, one manual line per department and device type with "Replaces <tags>" as its explanation.

## 3D package (wave 3)
- Live data: `twinLive(facilityId)` in `src/lib/assets/twin-live.ts` → `/assets/3d/live?facilityId=` (compact `LiveRow` tuples, see
  `twin/types.ts`); the view polls every minute and on tab focus. Problem layers are pure in `twin/layers.ts`.
- Actions from the model (`src/app/assets/3d/actions.ts`, return a result, no redirect): `twinMoveAction` and `twinPlaceAction`
  (`assets.move`; the spot must be inside the room outline; same posX/posY the 2D map uses), `saveViewAction` / `deleteViewAction`.
- Shapes: `deviceKind(groupCode, categoryCode)` in `twin/geometry.ts`; shapes within 75 m of the camera target, dots beyond.
- Saved views: table `twin_views` (private unless shared; author or admin deletes). View links `?v=` encode camera, floor, layer,
  grouping, spacing and filters (`twin/view-state.ts`, decoded defensively).
- CAD room names are cleaned of DWG formatting codes (`cleanCadText` in `scripts/seed/cad.ts`, `clean_text` in `tools/cad/build.py`,
  migration 0011 for existing data).

## Building heights
- La Plaza floors are 5 m floor to floor (`seed-data/cad/la-plaza.json`, `tools/cad/floors.json`; migration 0007 moves floors still on
  the old 4.5 m spacing). The 3D view draws walls 3.3 m high (`WALL_HEIGHT` in `src/components/assets/twin/scene.ts`).

## BOQ quick start (wave 3)
- Wizard `/boq/quick-start` (`boq.edit`): type, ownership, beds, services, special conditions, price tier and target budget, then a
  preview (`previewQuickStartAction`, nothing saved) and `createQuickStartAction`, which makes a normal draft BOQ and generates it.
- Templates and answers → departments: pure in `src/lib/boq/templates.ts` (`TEMPLATES`, `defaultAnswers`, `bedSplit`, `buildScope`).
- Department planning questions (exams, deliveries, chairs…): `src/lib/boq/questions.ts`, stored in `boq_departments.params`.
  An answer of 0 means "none planned" and gives quantity 0.
- Rules (migration `0013`): `boq_rules.param` / `param_ratio` (throughput sizing), `boq_rules.condition` (only when the BOQ has that
  feature in `boqs.features`; part of the unique index), table `device_companions` (accessories topped up to the shortfall).
  Reference data in `seed-data/boq-quickstart.json` — draft figures, to be reviewed by the biomedical team.
- Price tiers (`price_tier` BASIC / STANDARD / PREMIUM): pure in `src/lib/boq/pricing.ts` (`tierPriceUsd`, `effectiveTier`,
  `scenarioTotals`). Tier on the BOQ, the department or the line (line wins). `repriceBoqLines()` in `src/lib/boq/generate.ts`
  reprices from the catalogue bands and never touches a price typed by hand (`boq_lines.price_manual`).

# Wave 4 additions

## 3D view
- Floors load the linked floor first (`floorLoadOrder`), the rest three at a time; `TwinScene.build()` resolves after the first.
  Anything that reads a floor's view (`this.floors.get`) must allow it to be missing while loading; use `floorById` for data.
- Only pulsing (faulty) devices are updated per frame (`pulseDevices`); call `positionDevices()` after any change.
- Lifts, stairs and shafts come from room names (`coreKind` in `twin/geometry.ts`).
- Plan vs installed: `/assets/3d/plan?facilityId=&boqId=` (needs `boq.view`), rules in `src/lib/assets/plan-installed.ts`.
- Nearest working device: `twin/nearest.ts` (same floor first, other floors via lift/stairs, fixed cost per storey).

## BOQ checks and planning
- Pure rules: `fit-budget.ts`, `benchmarks.ts`, `risks.ts`, `room-requirements.ts`, `tco.ts`, `phasing.ts` in `src/lib/boq`;
  DB side in `checks-server.ts` and `planning-server.ts`. Tabs: Checks (`?tab=checks`), Phasing & costs (`?tab=phasing`).
- `fitToBudgetAction` recomputes the proposal on the server; never apply a client-sent list.
- Migration `0014_wave4_phasing`: `boq_departments.phase`, `boqs.opening_date`, `boqs.phase_months`.
- Demo seed `scripts/seed/plan.ts` (runs last): La Plaza's approved fit-out plan BOQ, phased.

# Wave 5 additions

## Register data entry
- Makes and models: table `device_models` (unique per device type + lower(maker) + lower(model)), pages `/catalogue/models`,
  `/catalogue/models/new`, `/catalogue/models/[id]`, actions in `src/app/catalogue/actions.ts` (`catalogue.edit`). Assets keep their
  `manufacturer` / `model` text; the catalogue is matched by name (`nameKey` in `src/lib/assets/models.ts`). Equipment forms use
  `<ModelDatalists>` with `list="dl-makers"` / `list="dl-models"` (`modelSuggestions()` in `models-server.ts`).
- Preferred models: `preferred_models` (per hospital and device type), set on `/assets/fleet` (`catalogue.edit` + facility access);
  `fleetSummary()` is pure.
- Tags: `assets.tags text[]` (lower case, `parseTags` in `src/lib/assets/tags.ts`), register filter `?tag=`, matched by `q` and search.
- Global search: `globalSearch(q, me)` in `src/lib/search.ts`, page `/search`, box in the top bar. Every group checks the permission
  and facility scope; add new groups the same way.
- Executive summary: `/reports/executive` (`reports.view`), figures pure in `src/lib/reports/executive-calc.ts`.
- Migration `0015_wave5_models_tags`. Demo seed `scripts/seed/models.ts` (runs after `plan`).
- Go-live: `npm run cad:load` (`scripts/load-buildings.ts`) loads buildings without demo equipment; checklist in `docs/deploy.md`.

## 3D view (visual)
- Styles `"dark" | "light"` (`TwinScene.setStyle`, palette `PALETTE` in `scene.ts`); the choice lives in localStorage
  (`hpams.twin.style`, read with `useSyncExternalStore` so the server renders the default).
- Whole-building view draws walls at `CUTAWAY` height; full height when a floor is isolated or the camera is near. Basements
  (`level < 0`) are hidden in the whole-building view unless `setShowBasements(true)`. Use `floorShown(id)` for visibility.
- Device models come from `kindGeometry()` (merged primitives, y = 0 at the floor); status rings are one `InstancedMesh`.
  `positionDevices()` sets every colour, so call it after any status, highlight or selection change.
- Labels: `buildLabels()` makes floor tags, department labels and room labels; `updateLabels()` picks by zoom and drops overlaps.
- Wave 5 additions to the 3D view: `viewPreset("iso" | "plan" | "eye")` (eye level isolates a floor and returns its id),
  `setSection(axis, at)` (global `renderer.clippingPlanes`), `setFacade(on)` (outline from `outlineFromRooms` in `twin/geometry.ts`),
  `setHeatMode("smooth" | "blocks")` (smooth = canvas texture of radial glows per affected room).

# Wave 6: reference figures
- Every planning reference figure (benchmarks, room needs, running costs, lead times, quick-start workload rules, special
  conditions, companions) is registered in `src/lib/boq/reference-figures.ts` with status (sourced / adjusted / judgement),
  reasoning and sources; values are read from the modules that use them. When you change a figure, update its note there.
- `npm run reference:sheet` rebuilds `docs/reference-figures-review.xlsx`; the summary is `docs/reference-figures.md`.
- Seeding upserts the quick-start rules, so changed workload rates reach existing databases on the next `npm run demo` or seed.

## Wave 7: lift cores and presentation renders
- Lift cores: `lift_cores` (stops per floor in plan units), pure logic in `src/lib/assets/lifts.ts` (`suggestLifts`,
  `liftAllowed`), loading/inserting in `lifts-data.ts` (takes `db`, so seeds can call it), UI under
  Facilities › Lifts. Declared people lifts (BED/PUBLIC) replace lifts read from room names in `scene.coreSpots()`.
- Renders: `src/components/assets/twin/render/`. Pure, unit-tested: `kits.ts` (room → finish and furniture kit,
  wall placement), `labels.ts`, `walls.ts` (wall lines → solid wall mass). `furniture.ts` builds the models in code
  (no model files). `studio.ts` renders off screen with its own renderer, separate from the live view;
  `render-panel.tsx` is the dialog. Kit furniture is illustrative and must stay labelled as such.

# Wave 14 additions
- Migration `0032`: `assistant_chats`, `room_standards`, `commissioning_plans`, `commissioning_rooms`.
- **Queue simulation** (`/flows/simulate`): engine pure and seeded in `src/lib/flows/simulate.ts` (`simulate`,
  `simulateOnce`; tested against M/M/1). The model (what each step waits for) is built by `buildSimModel` in
  `simulate-model.ts` with the same `placeOf` as the analysis, so the two agree; loading in `simulate-server.ts`.
  The page runs it in `simulate.worker.ts`. Resource capacity 0 means "not limited".
- **Commissioning** (`/assets/commissioning`): pure rules in `src/lib/assets/commissioning.ts` (planned dates from the
  handover + plan weeks; actual installed only after a recorded handover, when every device in the room is installed;
  accepted when every device has a signed acceptance). DB side `commissioning-server.ts`; charts are server SVG in
  `src/components/assets/commissioning-charts.tsx`; the 3D panel is a hook in `twin/commissioning-panel.tsx` (its
  tint wins over plan vs installed and problem layers). Edits need `facilities.edit`.
- **Room standards** (`/facilities/room-standards`): built-in set `seed-data/room-standards.json`, editable copy in
  `room_standards` on first change (as room kits). `standardFor` / `checkRoom` in `src/lib/assets/room-standards.ts`;
  areas are per bed space when a room has beds. The built-in figures are registered as reference figures, and a test
  keeps the imaging and theatre areas equal to `ROOM_NEEDS`.
- **Backups**: `src/lib/backups.ts` writes to a hidden `.partial-` file and renames; on PostgreSQL it runs `pg_dump`
  (`PG_DUMP_PATH`, connection through `pgDumpEnv` in `backup-env.ts`, never on the command line). `.gitignore` ignores
  only the top-level `/backups/` folder — a bare `backups/` hid `src/app/admin/backups` in wave 12.
- **Assistant**: tools `list_boqs`, `get_boq`, `service_contracts`, `recalls`; answers are parsed by `parseAnswer`
  (`answer-format.ts`) for both the chat and the Word file (`src/lib/docx.ts`, a minimal .docx writer on `zip()`).
  Chats are private to their owner (`chats-server.ts`).

# Wave 15 additions
- **Room survey gases**: `rooms.services.gases` (gas code → outlets in the room; type `RoomServices` in `schema.ts`, no
  migration). `checkRoom` compares them with the standard per bed space. Saved by `setRoomSiteAction` (`gas_<CODE>`).
- **Room standards in BOQ checks**: `roomStandardsCheck(ws)` in `src/lib/boq/planning-server.ts`; summary pure in
  `src/lib/boq/room-standards-check.ts`.
- **Simulation extras**: `SimOptions.hours` / `books` / `levels` in `simulate.ts` (all optional; unset = wave 14
  behaviour, the M/M/1 test still holds). Staff groups are added to the model by `withStaff` (`simulate-model.ts`);
  a step holds its room, then its staff. The page keeps one `SimScenario` (`src/lib/flows/scenarios.ts`):
  `cleanScenario` reads anything defensively, `buildRuns` makes the baseline and what-if. Saved scenarios: table
  `sim_scenarios` (migration `0033`), actions in `src/app/flows/simulate/actions.ts` (private unless shared; author or
  administrator deletes).
- **Render models**: `furniture.ts` builders are more detailed; `furniture.test.ts` keeps each model inside its
  `MODEL_SIZE` footprint (desk, nurse station and meeting table carry chairs outside it, as before) and under 12,000
  triangles.

# Wave 16 additions
- **View presets** (`twin/presets.ts`, pure): Imaging and ICU rooms by department type (`departments.department_type_code`,
  now sent as `TwinDepartment.typeCode`), room type or name. The preset's tint wins over every other room tint.
- **Device status by day**: table `asset_status_days` (migration `0034`, changes only, primary key asset + day).
  `snapshotStatuses()` (`src/lib/assets/status-history-server.ts`) runs with the hourly alert job; on an empty table
  it first rebuilds the past year from work orders' downtime (`reconstructDays`, source `reconstructed`). The 3D
  history feed sends the rows; `statusesOn` gives the statuses of a day; replay wins over live statuses in the scene.
- **Detailed models in the live view**: `deviceModel()` (`twin/render/device-models.ts`) picks a render model by
  catalogue code (longest prefix), else by kind; used by the scene and the render studio. `TwinScene.setDetailed`
  rebuilds the near shapes (keys `"m:<model>"`); `setFurniture(on, rules)` places room kits on the floor shown on its
  own, built once per floor (`buildFurniture`), around registered devices.
- **Drawing quality** (phase 1, migration `0035`): `rooms.outline_source` ("walls" | "split" | "fallback" | "drawn",
  null = not recorded), `rooms.verified_at/verified_by_name`, `floor_cad.alignment` and `revision`. Importers write
  them (`scripts/seed/cad.ts`, `cad-merge-data.ts`; a reshaped room loses its verified mark); `backfillCadSources`
  (`src/lib/assets/cad-sources.ts`) fills older data from `seed-data/cad/*.json` on every start (no-op when done).
  Checks and scores are pure in `src/lib/assets/drawing-quality.ts`; loading in `drawing-quality-server.ts` (segment
  counts by `jsonb_array_length`, unreachable rooms from `networkCoverage`). Page `/facilities/[id]/drawing-quality`,
  actions `setRevisionAction`, `verifyRoomAction` (`facilities.edit`). The 3D "Drawing confidence" tint and presets
  force the blocks heat mode.
- **CAD phase 2** (migration `0036`): `tools/cad/dxf.mjs` (DXF → the LibreDWG shape), `rules.mjs` (layer classes,
  room-text layers, symbol rules; a building config's `layers`/`symbols` first), `extract.mjs` takes the config as a
  third argument and writes `symbols`, `unmatched` block names and a `dims` check; `build.py` carries them as
  `floors[].symbols` (plan units, turn in radians) and `floors[].drawing`. App: `floor_cad.drawing`
  (`CadDrawingInfo`), table `drawing_symbols` (written by `writeFloorSymbols` in `src/lib/assets/cad-symbols.ts`, each
  in its room by `roomAt`). `drawingGasesFor` feeds `checkRoom`'s `drawingGases`; `symbolModel` draws symbols in the 3D
  furniture layer. Tests: `tools/cad/cad.test.mjs` with the generated sample (`tools/cad/sample/make-sample.mjs`).
- **Solid walls** (3D phase 3): `twin/solid-walls.ts` (pure, tested) — `shellOf` turns wall/column lines into wall
  boxes (raster + close, as `render/walls.ts`), door openings (what a wider closing fills next to a door line → lintel)
  and windows (glazing minus wall); `wallHeights` = floor-to-floor less a 0.35 m slab (top floor as the one below).
  `scene.ts` keeps each floor's geometry, builds the shell on first isolation (`buildShell`, instanced boxes, rebuilt
  on look change), hides the translucent walls on that floor, and scales those walls to `FloorView.wallH`.
- **Room templates** (3D phase 4): `RoomStandardSpec.equipment` (`TemplateItem`: code prefix, n, perBed, clearanceM)
  and `minWidthM`, in `seed-data/room-standards.json` (one rule per line, keep it that way). `checkRoom` counts
  `RoomSurvey.devices` (catalogue codes; absent = not checked, as in BOQ checks) with `codeMatches`, and checks
  `widthM` (`roomWidthM`, narrowest extent across edge directions). Equipment rows have `kind: "equipment"`.
  Server: `roomDevicesFor`, `roomWidth` in `room-standards-server.ts`; editor text format `parseEquipment` /
  `equipmentText`. BOQ: `templateNeeds` + `compareTemplateEquipment` (`roomStandardsCheck().equipment`).
  3D: `TwinRoom.template` from `checkedRooms`, tint `TEMPLATE_COLORS` (forces blocks), room card block.

## Wave 17 (3D roadmap phases 5–9, branch `wave-17`)
- **Equipment library** (migration `0037`, table `equipment_models`: a catalogue model's `glbUrl`, own `zones`,
  `connections`; null = typical). Pure: `src/lib/assets/equipment-library.ts` (typical entries by code prefix from
  `seed-data/equipment-library.json`, `libraryEntry`, `zoneRect`, `fringePoly`, `connPoint`, editor text formats).
  `ensureLibraryModels` (run in `seedReference`) adds the first set to the catalogue with typical site data.
  Server `libraryFor(devices)` → `TwinData.library` + `TwinAsset.lib`. Scene: `drawZones` (device frame u along the
  model's long axis, v across, same turn as the device), `loadModels` (GLTFLoader → `render/glb.ts` `glbToGeometry`,
  instanced under key `g:<url>`). GLB files: `.glb` allowed in storage, folder `equipment_model/<modelId>`, served to
  `assets.view` when a library row has that URL. Page `/catalogue/library` (+ actions, `catalogue.edit`).
- **Space planning** (migration `0038`, table `space_snapshots`): pure `src/lib/assets/space-planning.ts`
  (`grossArea` raster 0.5 m with wall gaps closed, `spaceSchedule`, `toSnapshot`, `compareSchedules`), server
  `facilitySpace` (rooms in metres, devices per room, template `minAreaM2`, cores by `coreKind`). Page
  `/facilities/[id]/space` + actions (`facilities.edit`). Layer `density` in `twin/layers.ts` (needs room `areaM2`).
- **Clash check**: pure `src/lib/assets/clash.ts` (`checkClashes(rooms, devices, doors)`: position-free checks for
  all devices, positional ones for `placed`; footprint frame as `drawZones`, `longX` from `MODEL_SIZE` of
  `deviceModel`; `mrSafe` by code). Server `facilityClashes` (door points as the scene finds them; guessed or < 2 m²
  outlines skip area checks) → page `/facilities/[id]/clashes` and `TwinData.clashes`; scene `setClashes` rings.
  `/assets/3d?assets=1,2,3` spotlights devices.
- **Flow on the model**: `twin/sim-on-model.ts` (`simPlace` maps simulator resource keys `room:r12|room:d4|bed:4|
  scan:<place>:<prefix>|lift:bed|lift:all` to rooms, scanner devices, lifts; `loadColor`). `TwinData.sim` from
  `hospitalSimModel`; the view runs `simulate.worker.ts` (10 runs, a week). Scene `setLiftTint`, `setMarkers(key,…)`
  (generalises the clash rings). Bed clearance: `twin/nav/clearance.ts` (`clearWidth` on the network grid, +3.5 cells
  calibrated on straight walls; `legClearance`; `longestThroughCorner`), used by `buildingChecks` for bed legs and by
  the Pathways panel.
- **Wave 19 (interface)**: `side-nav.tsx` (`ROLE_ORDER`/`orderSections`, folded groups and pins in localStorage);
  `components/auto-submit.tsx` (GET filter forms apply on change); maintenance `dueView`/`triageSort` in
  `lib/assets/maintenance.ts`; `/assets/3d/checks?what=clashes|templates|sim` loads 3D checks on demand
  (`TwinData.hasFlows` instead of the model); Table headers sticky on xl screens (no scroll box there).
- **Solid floors** (wave 18): scene `setSolidFloors` — opaque slab plane and room mesh with depth write, the
  thick `slabBox` shown in both looks (dark concrete in the dark one); `styleFloor`/`applyFloorVisibility` read it.
- **Photoreal**: `render/finishes.ts` (`finishPixels` seeded procedural tiles → `finishTexture` DataTexture, UVs in
  metres ÷ `FINISH_TILE`; `fittingSpots` grid of ceiling lights). Studio options `textures`, `lights` (in the build
  cache key). Video: scene `startRecording(title)` copies each rendered frame plus a caption band to a canvas
  (`captureStream`), the view's `recordTour` runs `MediaRecorder` (MP4 when supported) and stops with the tour.


## Wave 21: look, modules and shared parts

- **Look**: use the tokens (`bg-nav`, `text-gold-ink`, `shadow-[var(--shadow-card)]`, `font-display` …), never raw
  hex. `font-display` (Fraunces) is for page titles and big figures only. Gold (`gold`, `nav-gold`) is an accent for
  marks and for text on the dark menu; on a light ground use `text-gold-ink`. See every part at `/admin/design`.
- **Modules and menu**: a new page goes in its module in `src/lib/modules.ts` (`MODULES`); the side menu, the modules
  page, the path bar and the Ctrl+K box all read that file. Don't add links in `side-nav.tsx`.
- **Sortable lists**: headings are `<SortTh k="…">` (`@/components/ui/sort-th`); the page reads the choice with
  `parseSort(sp, KEYS)` and sorts with `sortRows(...)` (rows already loaded) or its own `orderBy` (paged in the
  database). Both in `@/lib/list`. Add `<SavedFilters />` under the filter form of a list whose filters are in the
  address, and carry `sort`/`dir` through the form as hidden inputs.
- **Form errors**: return `zodFail(parsed.error)` (not `fail(...zodErrors(...))`), so `<ActionForm>` can show each
  message beside its field. The field's `name` must match the schema key.
- **Charts and icons**: `@/components/ui/charts` (`BarList`, `Donut`, `Columns`, `Sparkline`) and
  `@/components/ui/icons` (`<Icon name="…" />`). No chart or icon package.
- **Waiting and errors**: `app/loading.tsx`, `app/error.tsx`, `app/not-found.tsx` cover every page; a section can
  add its own `loading.tsx` when its shape differs.

## Wave 22: 3D view drawing and panels

- `TwinScene` no longer draws every frame. Anything that animates on its own must keep the loop busy: set
  `this.flight`/`this.play`/`this.flashes`, or call `scene.wake(ms)` after a change that should show at once
  (a still view redraws within 100 ms anyway). Don't add a second `requestAnimationFrame` loop.
- Panels: one open per side, shown by `<HudRail>` (wave 22b). A new tool goes in `PANEL_COLUMNS` in `hud-state.ts`
  and in the `tools` list of its rail in `twin-view.tsx`, with a one-word `label`.
- `/assets/3d/geometry/[floorId]` answers with an ETag and gzip; keep it a plain GET so the browser can reuse it.

## Wave 23: safety records

- Rules are pure and tested: `lib/assets/incidents.ts` (what is reportable, what is still to do, when it may close),
  `lib/assets/risk.ts` (score, level, consistency checks), `lib/assets/safety-tests.ts` (limits, pass or fail,
  analyser calibration). Change a limit there, with its test, never in a page.
- An incident's or a safety test's device must be in a hospital the user can see (`requireFacilityAccess`).
- Asset history is kept: `incidents` and `safety_tests` reference assets with `onDelete: "restrict"`.

## Audit trail and data rules (wave 24)

- `logActivity(entity, id, action, summary, actor?, tx?, changes?)`: for an edit, read the row first and pass
  `diff(before, next)` from `@/lib/audit-diff`; put `changeSummary(changes)` in the summary. The account and the
  address are added for you.
- `activity_log` is insert-only (a database trigger). Never update or delete it, in code or in a seed.
- Nothing may cascade-delete from `assets`: use `onDelete: "restrict"`. Retire master data with its `active` switch.
- New money, quantity or date-range columns get a `check(...)` in `schema.ts`. `src/db/rules.test.ts` builds a
  scratch database from the migrations and checks these rules; add to it.
- An editable table has `updatedAt: updatedAt()`.

## Security (wave 25)

- **Two-step sign-in**: codes are in `lib/auth/totp.ts` (pure, RFC 6238 test values in the test), the half-signed-in
  state in `lib/auth/two-step.ts` (table `login_challenges`, cookie `hpams_login_step`, path `/login`). `signIn`
  creates a session only when no code is needed; otherwise `/login/code` (has two-step) or `/login/two-step` (must
  set it up, setting `twoStepRequired`). Never call `createSession` after a password check or an SSO callback
  without going through `secondStep(user, next)` (wave 34): it picks the session, the code page, the set-up page or
  "locked". Don't select `users.totpSecret` or `backupCodeHashes` into anything sent to a client component.
- **Showing backup codes**: they exist in clear only in the action's return value. A server action that sets a
  cookie re-renders the page, so the page must keep `CodeForm` in the same place afterwards or the codes vanish.
- **Content policy**: `lib/security-headers.ts`, applied in `src/proxy.ts` with a nonce per request. No inline
  `<script>` without the nonce (`headers().get("x-nonce")`), no scripts, styles, images or requests from other
  sites. If a new feature needs an outside address, add it there with a comment and extend the test.
- **Device security**: `lib/assets/device-security.ts` (`concerns`, pure), table `asset_security` (one row per
  device), panel `components/assets/security-panel.tsx`, page `/assets/security`.

## Screens for each role (wave 26)

- **Start page**: `ROLE_HOME`, `startPageOptions` and `landingPage` in `lib/modules.ts`; `users.start_page`. Every
  sign-in path (password, two-step code, two-step setup, Supabase callback) must send the person to
  `landingPage(next, user.startPage, user.role, permissionsOf(user.role))`. A role home must be a page that role
  can open (a test checks it).
- **Trends**: `lib/trends.ts` (months, labels, direction in words) and `PairColumns` in `components/ui/charts.tsx`.
- **Reports**: add a report to `lib/reports/registry.ts` and to a group in `app/reports/page.tsx`. Pure timing for
  work orders is in `lib/reports/work-calc.ts`.
- **Phone**: `/scan` uses `parseScan` from `lib/assets/rounds.ts` (same labels as rounds). `app/manifest.ts`,
  `public/icons/*`, `app/apple-icon.png`; these paths are excluded from the sign-in check in `src/proxy.ts` so a
  phone can read them before signing in.



## Wave 27

### Maintenance

- Usage rules are pure in `src/lib/assets/meters.ts` (`readingProblem`, `usagePoints`, `averageDailyUse`,
  `usagePpmDue`, `readingsFromMonthlyCounts`); DB side `meters-server.ts` (`usageDueMap(today, { ids })`).
  `nextPpmDue` takes an optional `usageDue` and returns the earlier date with `basis: "usage"`. **Any new place that
  computes a PPM due date must pass `usageDue` from `usageDueMap`**, or it will disagree with the maintenance page.
- Tables (migration `wave27_maintenance`): `meter_readings`, `maintenance_test_equipment`, `equipment_loans`,
  `training_sessions`, `training_attendees`; columns `device_types.usage_interval`, `usage_unit`; enums
  `meter_reading_kind`, `loan_direction`, `training_kind`.
- Test equipment on a visit: every code path that completes a maintenance visit calls `checkInstruments(fd,
  facilityId, date)` before writing and `saveInstruments(tx, eventId, list)` after
  (`src/lib/assets/test-equipment-server.ts`; pure rule `instrumentsProblem` reuses `analyserProblem`). Today those
  are `logMaintenanceAction`, `completeEventAction` (`src/app/assets/actions.ts`) and `completeWorkOrderAction`
  (`src/app/assets/work-orders/actions.ts`); add any new one. The form part is `<TestEquipmentField options={…} />`.
- The assets `ActionForm` (`components/assets/action-form.tsx`) now shows `FormState.fields` beside the input of
  that name, like the shared one. A field without a single input (a checkbox list) can carry an
  `<output name="…">` as the anchor.
- Loans: pure `src/lib/assets/loans.ts`, DB `loans-server.ts`; `notifyOverdueLoans` runs from
  `src/lib/notifications/alerts.ts`. Numbers `LN-YYYY-NNNN`. Activity entity `loan`.
- Training: pure `src/lib/assets/training.ts`, DB `training-server.ts`. Setting `trainingValidMonths`
  (`lib/settings.ts`). Documents entity type `training` (edit needs `maintenance.edit`), kind `sign_in_sheet`.
  An attendee counts for `coalesce(attendee.department_id, session.department_id)`. Inside a transaction,
  `addAttendees` must get the transaction (PGlite has one connection).
- Permissions (no new ones): meter readings, test equipment, loan checks and training need `maintenance.edit`;
  recording and returning loans `assets.edit`; usage intervals `catalogue.edit`.

### Finance

- Pure rules: `src/lib/assets/depreciation.ts` (`depreciation`, `depreciationTerms`, `inServiceDate`),
  `src/lib/reports/service-cost-calc.ts` (`contractShare`, `rollUp`, `cosrPct`, `yearlyCosr`, guide constants),
  `src/lib/procurement/supplier-docs.ts` (`docExpiry`, `expiringList`, `expiredWarning`, reminder key). Change a
  rule there with its test.
- DB side: `src/lib/assets/depreciation-server.ts` (`bookValues(where, onDate)` — EGP through `ratesFor` like the
  reports), `src/lib/procurement/supplier-docs-server.ts` (`supplierExpiryWarning` for any new place a PO or
  award is made).
- Migration `0043_wave27`: `device_types.residual_pct`, `assets.residual_pct` (checks 0–100,
  in `rules.test.ts`), `documents.expires_on` (indexed).
- `uploadDocument` reads an optional `expiresOn`; `DocumentUploadForm` takes `withExpiry`. The supplier page
  uses `SupplierDocumentsPanel` instead of `DocumentsPanel`.
- Alert `supplier_doc_expiring` (role PROCUREMENT, no facility), dedupe key
  `supplier_doc_expiring:<documentId>:<expiresOn>` — a renewed date gets one new reminder.
- Actions: `src/app/assets/depreciation-actions.ts` (type: `catalogue.edit`; device: `assets.edit` + facility),
  `src/app/procurement/suppliers/documents/actions.ts` (`suppliers.edit`). No new permissions.
- Reports group "Money" in `app/reports/page.tsx`; Finance sees it first.

### Fixes

- Password rule: `src/lib/auth/password-policy.ts` (`passwordProblem`, `PASSWORD_RULE`, `MIN_PASSWORD_LENGTH`; pure,
  tested). `lib/auth/password.ts` re-exports them. Call it only where a password is set or changed, never at
  sign-in. Return `{ errors: [p], fields: { password: p } }` so the message shows beside the field.
- Sessions: `listSessions(userId)` and `endSession(userId, sessionId)` in `lib/auth/session.ts` (never return
  `tokenHash`). `endSession` never ends the current session. `browserLabel(ua)` in `lib/auth/user-agent.ts` (pure).
  `createSession` stores the label and the address; keep it to that.
- Audit: `diff()` now also skips `totpSecret`, `totpLastStep` and `backupCodeHashes`, even when asked for them by name.
  For users, pass the field list explicitly. Read the row before the update, diff against the values you write, and
  pass `changes` as the 7th argument of `logActivity`.
- GMDN: `gmdnCodeProblem` / `cleanGmdnCode` in `lib/assets/device-type-codes.ts`; action
  `saveDeviceTypeCodesAction` in `app/catalogue/actions.ts`; form `components/assets/device-type-codes-form.tsx`.
- Long pages: `UnsavedGuard` (`components/ui/unsaved-guard.tsx`) once per page, and `data-unsaved-guard` on the form
  (or a wrapper around an `ActionForm`). Commissioning tabs and paging: `lib/assets/commissioning-view.ts`
  (`PLAN_TABS`, `pageOf`, `ROOMS_PER_PAGE`). `saveRoomsAction` saves only the rooms posted, so paging is safe.
- Worktrees: Turbopack can't build when `node_modules` is a symlink to a folder outside the project ("Could not find
  the Next.js package"). A hard-linked copy (`cp -al <repo>/node_modules node_modules`) works.


## Wave 28: 3D view and simulation

- `buildings.north_deg` (real, check 0 ≤ x < 360) and `equipment_models.glb_licence/glb_credit/glb_source/glb_bytes`
  (migration `0044_wave28`). Pure maths in `src/lib/assets/north.ts` (`cleanNorth`, `viewBearing`,
  `compassTurn`, `nearestTurn`, `northFor`); plan x right, plan y down = scene z; bearing 0 = looking up the plan.
  `TwinFloor.northDeg` carries the building's value. UI: `twin/hud-compass.tsx` (`HudCompass`, `MapNorth`).
- Model files: `src/lib/assets/glb-file.ts` (`checkGlb`, `parseModelCredit`, `creditsShown`, `isAppModelUrl`,
  `dropTextureRefs`). Upload and removal need `settings.manage` (administrators). All loading goes through
  `loadGlb`/`glbGeometry` in `twin/render/glb.ts`: one cache shared by the live view and the studio, only URLs under
  `/files/equipment_model/<id>/`, texture references removed before parsing (no image fetches; the content policy's
  `connect-src 'self'` is unchanged and a test keeps it so). `TwinLibrary.credit`; render credits are
  `twin/render/credits.ts` (`floorModelFiles`, `mergeCredits`, `creditsLine`). Shape key `g:<url>` uses vertex colours.
- Files tested by Vitest can't import `@/…` (no alias in the Vitest config): use relative paths in pure files and
  in client files a test imports (e.g. `hud-compass.tsx`, imported by `hud-map.tsx`).
- Simulation: `SimOptions.shifts` (24 numbers per resource key), `closed` (hours 0–23), `leaveAfter` (minutes by
  pathway id). Pools now have `capNow`/`capHour`/`limited`; capacity changes on the hour by events scheduled only when
  set, so unset runs consume the random numbers and event sequence exactly as before. Keep
  `simulate-shifts.test.ts`'s `WAVE_15` fingerprint passing when changing the engine (if a change is meant to alter
  results, say so and update it). New result fields: resources `waitHourly`; flows `left`, `waitByHour`,
  `patientsByHour`. `SimScenario.shifts/closed/leaveAfter`, read by `cleanScenario`, passed by `buildRuns` only when
  non-empty. Helpers `capacityByHour`, `cleanShift`, `cleanClosed`, `hourRange`, `closedLabel` in `simulate.ts`.
- Seed `scripts/seed/north.ts` (after `security`): sets the demo building's north only when it is blank and the
  building has no activity entry, so a cleared value stays cleared.

## Wave 29

- **Logging inside a transaction**: pass the transaction to `logActivity(…, tx)`. It reads the signed-in user
  through that transaction (`currentUserVia`). Never call anything that queries with `db` (getCurrentUser,
  requirePermission, facilityScope, getSetting…) inside `db.transaction`: with PGlite (one connection) it waits forever.
  Do those lookups before the transaction starts.
- **On loan**: `ON_LOAN` is in `ASSET_STATUSES` but not in `MANUAL_ASSET_STATUSES`; only loans set and clear it
  (`equipment_loans.status_before`). Status pickers and manual-change schemas use the manual list.
- **Meter at sign-off**: `readingAtVisit(fd, assetId, date, who)` in `lib/assets/meters-server.ts` checks the optional
  `meterReading` field and returns a `save(tx)` step; the field is `<MeterAtVisit assetId>`.
- **Depreciation method**: `getSetting("depreciationMethod")`, passed to `depreciation({ method, … })`; `bookValues`
  does it for you. `decliningWrittenOff` is the double-declining maths (tested against a worked example).
- **Who did the work**: `byProvider` in `lib/reports/service-cost-calc.ts`; cost lines carry `provider`.
- **Simulation**: `whatIf.shifts/closed/leaveAfter` (missing = as the baseline) and `leaveAny`; `buildRuns` applies them.
- **Breached passwords**: `breachedProblem` (`lib/auth/breached.ts`) after `passwordProblem`; fails open.
- **3D files**: state-free pieces live in `twin/scene-parts.ts` and `twin/twin-view-parts.tsx`; add new constants there.

## Wave 30: the 3D view's files

- `twin/twin-view.tsx` is the layout only. State and behaviour live in `twin/use-twin-view.tsx` (`useTwinView(props)`
  returns everything; `TwinCtx` is its type). Panels are components in `twin/panels/` taking `{ t }: { t: TwinCtx }`
  and destructuring what they use.
- Adding state: declare it in the hook and add the name to the object it returns (the return lists every name).
  Adding a panel: a component in `panels/`, then `const myPanel = <MyPanel t={t} />` in `twin-view.tsx`.
- Two reads of refs during render (`root.current` for the right-click menu's position, `sceneRef.current` for the render
  panel's camera) carry an `eslint-disable-next-line react-hooks/refs`: unchanged behaviour from before the split.

## Wave 31: scene.ts

- `TwinScene` (twin/scene.ts) keeps the fields, the constructor, small methods and one-line hand-offs. Larger method
  bodies live in `scene-build.ts`, `scene-overlays.ts`, `scene-view.ts`, `scene-interact.ts` and `scene-labels.ts` as
  `<method>Impl(scn, …)`. Change a body there; add a new large method the same way (method on the class that returns
  `fooImpl(this, …)`). `scene-build.ts` and `scene-view.ts` import `TwinScene` at run time for its static shapes; that
  circular import is safe because it's only read inside functions.

## Wave 38 notes
- New lists: use `DataTable` from `@/components/ui/data-table` (server sorting via `tableSort(sp, ALLOWED)`, column
  chooser, row ticks with bulk actions). Text on filled colours: `text-on-primary`, not `text-white`.
- Every new colour token needs a dark value in both dark blocks of globals.css; `src/lib/contrast.test.ts` checks it.
- Budget years: `budgetYear()` from `@/lib/procurement/budget-year-server`, helpers in `@/lib/fiscal-year`.
- Arabic only inside formal documents, through `<LegalNameAr>`; never in the interface.


## Wave 39 notes (documents, permissions, running it)
- **Documents are soft-deleted**: any new query on `documents` must add `isNull(documents.deletedAt)`. A new file for an
  existing document goes through `uploadDocument` with `documentId` (the old file moves to `document_versions`).
  Restore and purge (`restoreDocument`, `purgeDocument` in `lib/documents.ts`) need `settings.manage`.
- **Server actions**: `src/test/actions-permission.test.ts` fails when an exported action in a `"use server"` file
  doesn't call `requirePermission` / `requireUser` / `requireDocumentEdit` (or a local helper that does). Add a real
  exception to its `EXCEPTIONS` list with the reason only when the action is meant to be open.
- **Equipment requests**: `requests.create` / `requests.approve`; department scope through `mayRequestFor` /
  `mayApproveForDepartment` (`lib/assets/request-rules.ts`) with `myDepartments(me.id)`.
- **Signatures** store the account (`…SignedById`) and the name at the time; never take who signed from a form field.
- **Errors**: `onRequestError` (instrumentation) → `error_log`; `errorEntry` (`lib/error-log.ts`) leaves out
  redirects and not-found and masks secrets.

## Wave 39: phones and offline
- Camera scanning: always `useQrCamera(active, onCode, onError, formats?)` and `useCanScan()` from
  `@/components/qr-camera` (BarcodeDetector, else jsQR on a canvas ~6 fps; jsQR is imported only when needed).
- Working a job: the steps live in `lib/assets/work-order-steps-server.ts` (`progressJob`, `completeJob`,
  `bookJobPart`, `addJobNote`, `addJobLabour`; each takes an optional `inTx(tx)` run inside its transaction). The work
  order and parts actions and the My jobs sync all call them: change a step there, not in a copy.
- Offline My jobs: pure queue and conflict rules in `lib/assets/offline-jobs.ts` (`jobVersion` is the fingerprint a
  change is checked against; notes and parts don't change it). Phone storage `lib/offline/store.ts`; service worker
  `public/sw.js` (only `/assets/my-jobs` and `/_next/static/`; excluded from the sign-in check in `src/proxy.ts`).
  Table `offline_sync_log` makes a re-sent change apply once.

## Wave 41 (agent J): notifications, deputies, escalation
- `notifyUsers` now applies each person's choice per kind (`lib/notifications/prefs.ts`: APP / EMAIL / BOTH / OFF, role
  defaults in the `notificationRoleDefaults` setting, daily digest). A new kind: add a label in `types.ts` KIND_LABELS
  and put it in a `KIND_GROUPS` group (a test fails otherwise); safety-critical kinds go in `SAFETY_KINDS`.
- Approval steps: `trackPending` notes when a step became pending; `stepRecipients` (lib/approvals/server.ts) is who is
  asked, with deputies swapped in; `decisionFor` says whether someone decides and for whom. Committee signatures are
  never delegated. Pure rules (working days, Friday–Saturday weekend, deputies) in `lib/approvals/escalation.ts`.
- Fault reports: `lib/assets/fault-escalation.ts` (pure), checked every 5 minutes from the scheduler.
- Wave 41 table reads tolerate a database without the migration (`isMissingTable`), so older tests and installs keep
  working on the defaults.
