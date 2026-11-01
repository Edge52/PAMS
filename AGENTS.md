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
