# Running Hospital PAMS

Two ways, same app:

| | On a laptop | On a server (cloud or in the hospital) |
|---|---|---|
| For | trying it, a single user, working offline | the hospital team, several users at once |
| Database | embedded (a folder on the laptop) | PostgreSQL |
| Start | double-click a launcher, or `npm run demo` / `npm run local` | `docker compose up -d` |
| Address | http://localhost:3000 | https://your-domain |
| Backups | `npm run backup` (app stopped) | automatic, daily |

## Laptop

Needs Node.js 22+ ([nodejs.org](https://nodejs.org)).

- **Start demo.command** (or `npm run demo`) — the demo hospital, La Plaza in 3D, tenders, assets and one demo account
  per role (password `demo1234`, listed on the sign-in page). Data in `.pglite`. Delete that folder to start the demo over.
  The demo always uses its own embedded database, even if a `.env` names a real one.
- **Start Hospital PAMS.command** (or `npm run local`) — your own data, starting from the device catalogue, BOQ
  standards and default approval rules. The first visit asks you to create the administrator. Data in `.pglite-data`:
  this folder *is* your database — back it up (`npm run backup` while the app is stopped).

Only that laptop can open the app. To let colleagues on the same network use it, start it with `LAN=1 npm run local`
(then anyone on the network can reach the sign-in page, so use real passwords).

On a Mac, the first double-click may be blocked as "from an unidentified developer": right-click the file, choose
Open, then Open again. After that a double-click works.

The first start installs packages and builds the app (a few minutes); later starts take seconds and only rebuild
after an update. Keep the window open while you use the app; close it or press Ctrl+C to stop.

## Server (recommended for real use)

Any Linux server with Docker (a cloud VM with 2 vCPU / 4 GB RAM is plenty for one hospital), a domain name pointing
at it, and ports 80 and 443 open.

```bash
git clone <this repository> hospital-pams && cd hospital-pams     # or copy the folder
cp .env.example .env
#   set DOMAIN, POSTGRES_PASSWORD (long, letters and digits), SETUP_CODE, APP_URL=https://<DOMAIN>,
#   optionally APP_TIME_ZONE, SMTP_URL and MAIL_FROM
docker compose up -d --build
```

Then open `https://<DOMAIN>`: you'll be asked for the `SETUP_CODE` and to create the first administrator (the code
stops anyone else who finds the new site first from doing it). Add the other users under
**Administration › Users** and check **Administration › Approval rules & settings**.

What runs: the app, PostgreSQL 16, Caddy (gets and renews the HTTPS certificate), and a backup job that writes a
database dump and an archive of uploaded files to `./backups` every 24 hours, keeping 14 days. Copy `./backups` off the
server regularly (another machine, or object storage) — a backup on the same disk doesn't survive losing that disk.

Updating: `git pull` (or copy the new folder) and `docker compose up -d --build`. Database changes are applied on start.

### Restore

```bash
docker compose stop app
docker compose exec -T db pg_restore -U hpams -d hpams --clean --if-exists < backups/hpams-YYYYMMDD-HHMM.dump
docker compose run --rm -v "$PWD/backups:/b" --entrypoint sh app -c "cd /data/uploads && tar -xzf /b/uploads-YYYYMMDD-HHMM.tar.gz"
docker compose start app
```

Test a restore on a spare machine once, before you rely on it.

### Without Docker

Node.js 22+ and PostgreSQL 15+: set `DATABASE_URL` in `.env`, then `npm ci && npm run build && npm run db:migrate &&
npm run db:seed -- --only=none && npm start`, behind a reverse proxy that provides HTTPS (nginx, Caddy, IIS). Set
`SETUP_CODE`, and `TRUST_PROXY=1` when the proxy sets X-Forwarded-For. Run it as a
service (systemd, PM2 or NSSM on Windows) and schedule `npm run backup`.

## Security checklist before going live

- HTTPS only (Caddy does this in the Docker setup). Set `APP_URL` to the https address.
- Don't load demo data (`--only=none`; the Docker image does this). Demo accounts are never added to a database that
  already has real users, and **Show demo accounts** in settings should be off.
- One account per person; switch accounts off when people leave (Administration › Users).
- Restrict facility access for users who work in one hospital only.
- Keep the server updated and backups copied off it.

## Going live at a hospital (La Plaza pilot)

1. **Server**: follow *Server* above on the cloud VM, with the hospital's domain (e.g. `pams.laplaza-hospital.eg`)
   pointing at it. Create the first administrator with the `SETUP_CODE`.
2. **Building**: load the floors, rooms and departments from the CAD import, without demo equipment:
   ```bash
   docker compose exec app npx tsx scripts/load-buildings.ts
   ```
   (`npm run cad:load` without Docker.) It skips a hospital that already exists, so it is safe to run again.
3. **Email** from the hospital's domain: put the mailbox's SMTP address in `.env`, then `docker compose up -d`, and
   switch email on under **Administration › Approval rules & settings**. Typical settings:
   - Microsoft 365: `SMTP_URL=smtp://pams%40laplaza-hospital.eg:PASSWORD@smtp.office365.com:587`
   - Google Workspace: `SMTP_URL=smtps://pams%40laplaza-hospital.eg:APP-PASSWORD@smtp.gmail.com:465` (an app password)
   - The hospital's own mail server: ask IT for the host, port and a mailbox for the system.
   - `MAIL_FROM="Hospital PAMS <pams@laplaza-hospital.eg>"`. Write `@` in the user name as `%40`.
4. **People**: add each user under **Administration › Users** with their role and hospital. The biomedical engineer
   who assigns jobs needs the *Biomedical engineer* role.
5. **Equipment**: register it with **Assets › Import** (Excel), **Bulk placement** or **Register asset**. Fill
   **Device catalogue › Makes and models** first (or let *Add the makes and models in the register* build it after an
   import), so makes and models are spelt one way; then set preferred models under **Fleet & standardisation**.
6. **Labels**: print QR labels from the register (select, then *Print labels*). Scanning one opens the device page with
   *Report a fault*.
7. Check the security list above, and that the nightly backups are copied off the server.
