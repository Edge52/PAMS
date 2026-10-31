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
| Procurement officer | projects, specs, RFQs, suppliers, offers, award recommendations, POs, receiving |
| Finance | approves POs above the finance threshold |
| BOQ planner | BOQs and BOQ standards |
| Biomedical engineer | assets, maintenance, facilities and rooms, catalogue, specs, BOQs, receiving |
| Technician | asset moves and maintenance records |
| Department head, Viewer | nothing (read only) |

Users can be limited to some facilities. Purchase orders, BOQs and awards go through approval chains set under
**Administration › Approval rules & settings**. Tender committees follow Egypt's public contracts law (Law 182/2018):
envelope-opening and adjudication committees, required Ministry of Finance and State Council members above the value
thresholds, award approved by the competent authority, and the complaint window after notification.

## 3D view and CAD import

**Assets › 3D view** shows a facility as an interactive 3D building with every registered device in its room: rotate,
zoom, spread the floors apart, isolate a floor, filter by equipment type or status, search a device and fly to it,
and click any room or device for its details (faults pulse in amber and red). It works for any facility; floors
imported from CAD show the real walls, doors, glazing and columns.

La Plaza Hospital is imported from its DWG floor plans (`seed-data/cad/la-plaza.json`, 9 floors, 1,414 rooms with
their real outlines). Its equipment is an **illustrative fit-out generated from room names** (beds and monitors in
ward rooms, the critical-care set in ICU bays, a CT in the CT room…), marked as demo data in each asset's notes.
Replace it with the real register via Assets › Import. To import new or revised drawings, see `tools/cad/README.md`.

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

## Known limitations

- Rooms drawn by hand on the floor map are rectangles; rooms imported from CAD keep their real outlines. Moving an
  asset to another floor is done from its page, not by dragging on the map.
- Maintenance costs are recorded per event in their own currency. There's no maintenance budget view yet.
- One contact per supplier (extra contacts go in notes).

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
| `src/components/assets/twin` | The 3D view (three.js scene, HUD, geometry helpers). |
| `tools/cad`, `seed-data/cad`, `scripts/seed/cad.ts` | DWG → building pipeline, imported buildings, and their import into the system. |
| `src/lib/asset-factory.ts` | The single place assets are created (tags, defaults, warranty). |
| `AGENTS.md` | Engineering conventions. |

## Tests

```bash
npm run typecheck
npm run lint
npm test
```
