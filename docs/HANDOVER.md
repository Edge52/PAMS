# Hospital PAMS — handover

The starting point for anyone (or any new Claude session) picking up the project. It says what the app is, how it's
built and run, how work is done here, what's finished and what's left. Last updated 5 Nov 2026, after wave 13 was
merged into `main`.

Read next: `AGENTS.md` (coding conventions; they're strict), `docs/system-documentation.md` (modules in depth),
`docs/user-guide.md` (by role), `docs/deploy.md` (servers, Supabase), `CHANGELOG.md` (what each wave added),
`docs/plans/wave-8-onwards.md` (the full plan the remaining items come from).

---

## 1. What the app is

Hospital PAMS is a web app for a hospital group in Egypt, covering the life of medical equipment:

| Area | What it does | Where |
| --- | --- | --- |
| **Planning (BOQ)** | Equipment bills of quantities from beds, rooms and standards; quick start; room kits; pricing and checks; capital plan | `/boq`, `/assets/capital-plan` |
| **Procurement** | Projects and tenders under Egyptian Law 182/2018: specs, RFQs, offers, compliance, committees, comparison with TCO, two-envelope opening, bonds, minutes, award, POs, receiving | `/procurement` |
| **Money** | Budget lines (capital and maintenance), commitments, invoices with three-way match, framework agreements and call-offs, supplier scorecards | `/procurement/budgets`, `/invoices`, `/frameworks` |
| **Assets** | Register, QR labels, acceptance checklists, work orders, PPM, contracts and penalties, spare parts, recalls, disposals, imaging use, fleet standardisation, rounds and stock-take, department view and equipment requests | `/assets` |
| **Buildings** | Facilities, floors from CAD (DWG pipeline), layout editor with polygon rooms, 2D floor map, 3D digital twin (routes, problem layers, plan vs installed, site-fit checks, pathways) | `/facilities`, `/assets/3d`, `/assets/map` |
| **Patient pathways** | Pathway steps on the 3D model, walking distances, clean/dirty conflicts, analysis | `/flows` |
| **Cross-cutting** | Approvals engine, notifications (in app and email), reports and executive summary, global search, audit log, backups, assistant | `/approvals`, `/reports`, `/admin`, `/assistant` |

Roles: Administrator, Director, Procurement, Finance, Planner, Biomedical, Technician, Department head, Viewer. The
permission matrix is one file, `src/lib/auth/permissions.ts`. Users can be limited to some hospitals; department
heads can be given departments they look after.

Demo data: two hospitals. Facility 1 is the demo general hospital (`DGH`); facility 2 is **La Plaza** (`LPH`, built
from real CAD drawings). Demo accounts are `<role>@demo.hpams` with password `demo1234` (e.g. `admin@demo.hpams`).
Demo figures (site planning values, imaging volumes, budgets) are labelled as demo.

---

## 2. How it's built

- **Stack**: Next.js 16 App Router (server components and server actions), React 19, TypeScript strict, Tailwind 4,
  Drizzle ORM, PostgreSQL 16 or embedded PGlite, three.js, ExcelJS, zod 4, Vitest, Playwright.
- **Size**: about 80 tables in `src/db/schema.ts`, migrations `drizzle/0000`–`0031`, about 107 pages, 500+ unit tests.
- **Database**: `npm run demo` and `npm run local` use embedded PGlite (`.pglite` for the demo, `.pglite-data` for
  your own data). A server uses PostgreSQL via `DATABASE_URL`; Supabase works too (`DATABASE_SSL`, see deploy guide).
- **Layout** (more in `docs/system-documentation.md` › Codebase map):
  - `src/app/<module>/` pages and colocated `actions.ts` (`"use server"`, exports only async actions)
  - `src/lib/<module>/` logic: pure files (`*.ts`, unit tested) and server files (`*-server.ts`, `import "server-only"`)
  - `src/components/` UI; `src/components/ui` shared pieces; `src/components/assets/twin/` the 3D view
  - `scripts/` launcher, migrate, seed (`scripts/seed/*.ts`), backup, CAD loaders; `tools/cad/` DWG pipeline
  - `seed-data/` taxonomy, standards, department types, La Plaza building
- **Things that bite** (all in `AGENTS.md`):
  - `params`/`searchParams` are Promises; pages reading the database need `export const dynamic = "force-dynamic"`.
  - A `"use server"` file may only export async functions: put helpers in `src/lib/...`.
  - Every page and action checks the permission first, then facility access (`requireFacilityAccess`,
    `facilityScope`).
  - Writes go through zod, then `logActivity(...)`; assets only via `createAsset`, stock via `applyMovement`,
    notifications via `notifyUsers`/`notifyRole`, numbers via `nextNumber`.
  - Schema change: edit `schema.ts`, `npx drizzle-kit generate --name <name>`, commit the migration.
  - React lint is strict: no setState in effects, no reading refs during render, no `Date.now()` during render.
  - Status badge colours live in `src/lib/status.ts`.

---

## 3. Running it

| | Command |
| --- | --- |
| Demo on the Mac | Double-click **Start demo.command** (or `npm run demo`), open http://localhost:3000 |
| Own data on the Mac | **Start Hospital PAMS.command** (or `npm run local`) |
| Server | `docker compose up -d --build` (see `docs/deploy.md`) |
| Checks | `npx tsc --noEmit -p .`, `npx eslint src scripts`, `npx vitest run` |

The launcher migrates, seeds reference data, **builds only when the code changed** and starts a production server.
After pulling new code, restart the launcher so it rebuilds. Your data is kept.

Optional settings in `.env` (all in `.env.example`): `SMTP_URL`/`MAIL_FROM` for email; `DATABASE_SSL`,
`DATABASE_SSL_CA`, `DATABASE_POOL_MAX` for Supabase/hosted Postgres; `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_PROVIDERS` for Microsoft/Google sign-in; `ANTHROPIC_API_KEY` for the assistant (then switch it on in
Administration › Settings).

---

## 4. Where the code lives

- GitHub: **Edge52/PAMS**, branch `main` has everything up to wave 13.
- Hisham's Mac: `/Users/edge/Desktop/Z/PAMS` (kept on `main`; update with `git pull`, then restart the launcher).
- Old branches that can be deleted on GitHub: `wave-7`, `wave-8`, `wave-10`, `wave-12`, `wave-13`, `fix/demo-restart`,
  `plan/wave-8` and the two `claude/...` branches. They're all merged or superseded.

## 5. How we work

- Build each piece of work on its own branch (`wave-N`), commit in steps, push the branch.
- **Merge into `main` only when Hisham says OK.** Then push and update the Mac.
- Before each commit: type check, lint, unit tests; for UI work, try it in the demo with Playwright (log in as
  `admin@demo.hpams` / `demo1234`; the 3D view needs Chromium's swiftshader flags).
- Update `CHANGELOG.md`, `README.md`, `docs/user-guide.md` and this file with each wave.
- Write the interface and docs in plain, short English. **No Arabic interface** (Hisham dropped it).

---

## 6. What's done

Waves 1–13 are merged. Highlights per wave (details in `CHANGELOG.md`):

| Wave | Contents |
| --- | --- |
| 1–6 (releases 1.0–3.0) | BOQ, procurement and Law 182 workflow, assets and maintenance, approvals, notifications, reports, search, 3D view, roles and facility limits |
| 7 | Lift cores, renders, real-size equipment, drawing updates, walking routes, patient pathways, tours |
| 8 | Finish and harden: render options, performance, fixes |
| 9 | Site planning (will it fit, MRI 5 gauss), imaging use, capital plan, TCO, contract statements, recall matching |
| 10 | Budgets, invoices and three-way match, frameworks, scorecards, acceptance, two-envelope tenders, bonds, minutes |
| 12 | Department view and requests, rounds and stock-take, audit log, backups page, supplier contacts, maintenance budget, room outlines, room data sheets, routes in a worker, clean/dirty routes |
| 13 | Department heads edit their own pathways and room zones; Supabase database and Microsoft/Google sign-in; the assistant; Law 182 notes removed (confirmed) |

Decisions Hisham has made: Law 182 rates and steps confirmed (bid bond 1.5 %, performance bond 5 %, two-envelope
steps, minutes); no Arabic interface; department heads may edit pathways; the assistant is wanted (off by default);
Supabase for sign-in and possibly the database; he will enter site planning figures himself from the makers' guides;
no finance export or e-procurement portal yet.

---

## 7. What's left

### Needs something from Hisham first

| Item | What's needed |
| --- | --- |
| Switch on Microsoft/Google sign-in | A Supabase project: URL and anon key in `.env`, Azure and/or Google providers set up in Supabase, the callback URL added. Not yet tried with real accounts. |
| Move the database to Supabase | The project's session pooler connection string; then `npm run db:migrate` and `/setup` (steps in `docs/deploy.md`). |
| Switch on the assistant | `ANTHROPIC_API_KEY` on the server, then Administration › Settings. Only tested against a stand-in API so far: try real questions and tune the prompt in `src/lib/assistant/run.ts`. |
| Go-live | The real server and domain, the hospital mail server, the user list with roles; a full Docker build and a load test there. |
| Real data | La Plaza's equipment register; site planning figures from the makers' guides (Catalogue › model › site data); agreed reference figures (`docs/reference-figures-review.xlsx`); real imaging volumes. |
| Finance (ERP) export | The finance system's format, when there is one (the invoice CSV covers it for now). |
| E-procurement portal export | The portal's file format, when there is one. |

### Ready to build (no input needed)

| Item | Notes | Size |
| --- | --- | --- |
| **B3 Queue simulation** | Discrete-event simulation of a pathway over a day or week: arrivals by profile, waits for rooms, beds, scanners, staff and lifts; waiting times, queues and utilisation by hour. Plan section B3. | L |
| **C5 Commissioning timeline** | For a new building or wing: rooms delivered, installed and accepted by week, as a time slider in 3D and a Gantt in the project. | M |
| Room data sheets per room type | Standard finishes and services per room type, on top of today's per-room sheet. | M |
| Better furniture models for renders | Openly licensed models in place of the simple boxes. | S–M |
| Backups on PostgreSQL | The backups page makes database dumps only for the built-in database; on a server the nightly `pg_dump` job does it. Could call `pg_dump` from the page. | S |
| Assistant extras (optional) | More look-ups (BOQs, contracts, recalls), saved chats, answers as a downloadable document. | S–M |

### Pilots, when partners are ready

| Item | Needs |
| --- | --- |
| B5 Building services (MEP) layers | Drawings with MEP layers (medical gases, electrical, HVAC…) |
| B2 Volumes from the HIS | A file import can be built now; a live link needs the HIS vendor |
| D3 automatic imaging volumes | A RIS/HIS (MPPS) feed |
| B4 Real-time location | An RTLS vendor and tags |
| B6 BIM (IFC) import and campus view | An IFC model |

### Housekeeping

- Delete the old branches on GitHub (section 4).
- `docs/system-documentation.md` describes the app at release 3.0 in depth; its "Known limitations" and "Backlog"
  tables are out of date. This file is the current list.

---

## 8. Starting a new session

1. Clone or open the repo, `npm ci`, then `npm run demo` (first start builds; it takes a few minutes).
2. Read `AGENTS.md` and this file.
3. Branch from `main` (`git switch -c wave-14`), build, check, push the branch, and ask Hisham before merging.
