# Wave 28: 3D view and simulation shifts (branch `wave-28-3d`)

## Changelog

- **North arrow.** Each building can store where north is (Facilities › hospital › Buildings › Edit, "North,
  degrees", clockwise from the top of the plans; blank = not known). When it is set, the 3D view shows a north arrow
  on the mini-map and a small compass above it whose needle turns with the camera. The render title block's north
  arrow now turns to the building's north as well (it still points to the top of the plan when north isn't known).
  The demo general hospital's main building is set to 20° (demo value); La Plaza is left blank for someone who knows.
- **Own model files with licence and credit.** In Catalogue › 3D library an administrator can upload a `.glb` for a
  catalogue model with a required licence, credit line and source address. The file is checked by its bytes: glTF
  binary mark, version 2, length, chunks, readable description, at least one mesh, nothing linked outside the file,
  no Draco/meshopt compression; up to 25 MB. The 3D view draws it in place of the built-in shape (now in both the
  simple and detailed looks, in its own colours), scaled to the model's real size. Renders draw it too and list the
  credits under the preview, in the title block and on the floor book cover. Files uploaded before this wave show
  "Licence and credit not recorded" until uploaded again.
- **Small targets.** Controls under 24 px in the 3D view were measured in the demo and enlarged (see the commit for
  the list).
- **Simulation shifts.** The patient pathway simulation now has: staff numbers by hour of the day for porters and
  staff groups ("Staff by hour of the day"), beds and rooms closed for some hours ("Closed at night"), and patients
  leaving unseen after waiting longer than a set time for their pathway's first step ("Leaving without being seen",
  per pathway). Results show a "Left unseen" column and, per pathway, average waits by hour of arrival; each
  resource's chart also shows its average wait by hour. Left empty, every result is exactly as before (a test
  fingerprints the wave 15 output).

Not covered: the what-if column doesn't have its own shifts, closed hours or limits (the what-if uses the same as
the baseline); a patient can leave only before their first step (not from later queues or while waiting for a
porter); the compass isn't clickable (it doesn't turn the camera to north); the 3D view uses one north for the whole
hospital only when every building with a north agrees. Item 5 (splitting `twin-view.tsx` and `scene.ts`) was not
done: see the report.

## Agents

- `buildings.north_deg` (real, check 0 ≤ x < 360) and `equipment_models.glb_licence/glb_credit/glb_source/glb_bytes`
  (migration `0043_threed_north_glb`). Pure maths in `src/lib/assets/north.ts` (`cleanNorth`, `viewBearing`,
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

## User guide

**North arrow.** Facilities › hospital › Buildings › Edit. Type where north is, in degrees clockwise from the top of
the plans (for example 30 if north points a little to the right), and save. Leave it blank if you don't know. The 3D
view then shows a north arrow on the mini-map and a compass that turns as you move the camera.

**Own 3D model files.** Catalogue › 3D library › Edit a model. An administrator chooses the `.glb` file, enters the
licence (for example CC BY 4.0), the credit line the licence asks for and the address the file came from, then
presses Upload. Use only files you have the right to use. Export a single `.glb` with everything inside it and no
compression. The 3D view and renders then draw that model for every device of it, at its real size. Renders list the
credits under the preview, in the title block and in the floor book.

**Simulation shifts.** Pathways › Simulate. Under the settings:
- *Staff by hour of the day*: choose porters or a staff group, set the day hours and how many are on duty by day and
  at night, press Fill the hours, then change any hour.
- *Closed at night*: choose beds or a room and the hours they are closed.
- *Leaving without being seen*: choose a pathway and how many minutes a patient waits for the first step before
  leaving.
Run the simulation. The pathways table shows how many left unseen; press Waits by hour for the average wait by the
hour patients arrived.
