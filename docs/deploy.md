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

What runs: the app, PostgreSQL 16, Caddy (gets and renews the HTTPS certificate), and a backup job
(`scripts/nightly-backup.sh`) that writes a database dump and an archive of uploaded files to `./backups` every 24
hours, keeping 14 days. Each dump is checked with `pg_restore --list` before it counts; old backups are removed only
after a good run, so a failing job never empties the folder. The result of the last run is in `backups/.nightly-status`;
**Administration › Backups** shows it, and administrators get a notification (and an email, when email is set up) when
the nightly backup fails or the newest good database backup is more than two days old. Copy `./backups` off the
server regularly (another machine, or object storage) — a backup on the same disk doesn't survive losing that disk.

**Administration › Backups** lists the same folder (the app sees it as `/data/backups`): the age of the last database
backup, a restore check that each file opens, downloads, and **Back up now**, which runs `pg_dump`. The image includes
the PostgreSQL client with the same major version as the database (16), so its dumps restore with the database
container's `pg_restore`; for a PostgreSQL 17 server (Supabase) set `PG_CLIENT_MAJOR=17` in `.env` before building. The app runs as user 1000, so let it
write there once: `mkdir -p backups && sudo chown 1000:1000 backups`. Without Docker, install the PostgreSQL client tools
(`pg_dump` at least as new as the server) or point `PG_DUMP_PATH` at one; the connection comes from `DATABASE_URL` and
`DATABASE_SSL`, and the password is never put on the command line. Files made from the page are named like the
nightly ones (`hpams-YYYYMMDD-HHMM.dump`, UTC time) with the uploads as a `.zip`. Backup files are readable by
their owner only (0600); the nightly job hands its files to the app's user (`APP_UID`, default 1000).

**Updates.** On every start the app applies new database migrations. Before it does, it writes a copy of the database
(`hpams-premigrate-….dump`) to the backup folder, and it takes a lock so two app containers starting together don't
migrate at the same time. If that copy fails, the app doesn't start and nothing is changed; fix the cause, or set
`MIGRATE_BACKUP=0` to go on without the copy. Every optional setting in `.env` (assistant key, Microsoft/Google
sign-in, database SSL and pool size, `ALERTS_DISABLED` on a second instance) is passed to the app container.

**Fonts.** The font files ship with the app (`src/app/fonts`) and are served by it, so neither the site nor the build
needs to reach Google.

Updating: `git pull` (or copy the new folder) and `docker compose up -d --build`. Database changes are applied on start.
Reference data (device catalogue, BOQ standards, department types) is only added on start, never overwritten, so your
edits to device life, PPM intervals, BOQ rules and the default standard set survive updates. To deliberately reload it
from `seed-data/`: `docker compose exec app npx tsx scripts/seed.ts --only=none --refresh-reference`.

### Restore

```bash
docker compose stop app
docker compose exec -T db pg_restore -U hpams -d hpams --clean --if-exists < backups/hpams-YYYYMMDD-HHMM.dump
docker compose run --rm -v "$PWD/backups:/b" --entrypoint sh app -c "cd /data/uploads && tar -xzf /b/uploads-YYYYMMDD-HHMM.tar.gz"
# or, for an uploads .zip made with Back up now:
# docker compose run --rm -v "$PWD/backups:/b" --entrypoint sh app -c "cd /data/uploads && unzip -o /b/uploads-YYYYMMDD-HHMM.zip"
docker compose start app
```

Test a restore on a spare machine once, before you rely on it.

### Without Docker

Node.js 22+ and PostgreSQL 15+: set `DATABASE_URL` in `.env`, then `npm ci && npm run build && npm run db:migrate &&
npm run db:seed -- --only=none && npm start`, behind a reverse proxy that provides HTTPS (nginx, Caddy, IIS). Set
`SETUP_CODE` (required: on a server with PostgreSQL and `NODE_ENV=production`, setup stays locked without it), and
`TRUST_PROXY=1` when the proxy sets X-Forwarded-For. Run it as a
service (systemd, PM2 or NSSM on Windows) and schedule `npm run backup`.

After the first sign-in, set *Admin › Settings › Sign-in* to require two-step sign-in at least for administrators.
Set `APP_SECRET` in `.env` first (32+ random characters, e.g. `openssl rand -base64 48`): the two-step secrets are then
stored encrypted. Keep a copy of it with the database backups and never change it; secrets saved before it was set
are encrypted the next time each person signs in with a code.
The app sends its own security headers (content policy, no framing, HSTS when `APP_URL` is https); don't add a
second `Content-Security-Policy` at the proxy.

### On Supabase (database and Microsoft / Google sign-in)

PAMS can use a Supabase project as its database, and Supabase Auth for "Sign in with Microsoft / Google". Supabase only
confirms who someone is: they get in only if an **active PAMS user with the same email** exists, and they get that
user's role, hospitals and departments. Password sign-in keeps working, so keep at least one administrator password.

**Database.** In Supabase › Connect, copy the *Session pooler* connection string (port 5432; it works over IPv4 and
keeps the long-lived connections PAMS uses). Then in `.env`:

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
DATABASE_SSL=require          # encrypted; checks the certificate (use no-verify only to test)
DATABASE_SSL_CA=/path/prod-ca-2021.crt   # optional: Supabase's CA from Database settings › SSL
DATABASE_POOL_MAX=10
```

Run `npm run db:migrate` once, then `npm run db:seed -- --only=none` and open `/setup` to create the first
administrator. Backups (`npm run backup`) need `pg_dump` 15+ on the server; Supabase also keeps its own daily backups.

**Sign-in.** In Supabase › Authentication › Providers, turn on *Azure* (Microsoft Entra ID) and/or *Google* with the
client ID and secret from your Entra app registration or Google Cloud project, using the callback URL Supabase shows.
Under Authentication › URL configuration add `https://<your PAMS address>/auth/callback` to the redirect URLs. Then:

```
APP_URL=https://pams.example.org
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon / publishable key>
SUPABASE_PROVIDERS=azure,google   # the buttons to show
```

Restart PAMS; the sign-in page shows the buttons. Add each person in Administration › Users with the email they use
at Microsoft or Google (the password can be anything long; they won't need it).

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
