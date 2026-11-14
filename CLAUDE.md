# Hospital PAMS

Read `docs/HANDOVER.md` first: what the app is, how it's run, how we work, and what's left to do. Coding conventions
are in `AGENTS.md` and are strict.

Working rules:
- Work on a branch (`wave-N`); push it. Merge into `main` only when Hisham says OK, then update his Mac
  (`/Users/edge/Desktop/Z/PAMS`: `git pull`, then restart the demo).
- Before each commit: `npx tsc --noEmit -p .`, `npx eslint src scripts`, `npx vitest run`; with the demo running,
  `npm run check:pages`; try UI changes in the demo (`npm run demo`, `admin@demo.hpams` / `demo1234`).
- Plain, short English in the interface and docs. No Arabic interface.
