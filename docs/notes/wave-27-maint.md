# Wave 27 — maintenance (branch `wave-27-maint`)

## Changelog

- **Usage meters and usage-based planned maintenance.** A device type can carry a usage interval and unit
  ("every 5,000 hours", "every 10,000 scans", "every 1,000 cycles") on its catalogue page. Each device gets meter
  readings (date, reading, unit, who, note). Readings can't go backwards, except a reading marked "the meter was reset
  or replaced". Planned maintenance is now due on whichever comes first: the months interval or the date the usage
  interval runs out, estimated from the average use per day. The asset page has a **Usage** panel (last reading,
  average use a day, use since the last PPM, when usage-based PPM falls due, a form to add a reading). The
  maintenance due lists, the register's "Next PPM", the register export, the PPM compliance report and "Generate
  scheduled PPM visits" all use the earlier date. Scanners already recording monthly exam counts (Imaging use) count
  them as their meter, for types measured in scans, until the device has its own readings.
- **Calibration check on planned maintenance sign-off.** Completing a scheduled visit (Maintenance › Schedule ›
  Complete), recording completed maintenance on the asset page, and completing a work order (with or without a
  checklist) now offer "Test equipment used (optional)": the hospital's devices marked as test equipment, with their
  calibration dates. Completion is refused when a chosen instrument's calibration ran out before the day of the work;
  the message shows under the list. The instruments and their calibration dates on the day are kept with the visit
  and shown in the asset's maintenance history and on the work order. Reopening a work order clears them.
- **Loans and rentals** (Assets › Loans and rentals, `/assets/loans`). A loan: borrowed from or lent to, the other
  party (a listed supplier or any name), the device (a registered one by tag, or a description for a borrowed device
  not in the register), department, why, dates out / due back / returned, condition out and back, rental cost. A
  borrowed device has a **check before use**: planned maintenance and electrical safety test in date, with who checked
  and when (the page suggests the answer from the register when the device is in it). Tabs: open, overdue, returned,
  all. Loans also show on the asset page. An overdue loan notifies the hospital's biomedical engineers once (hourly
  alert job, key `loan_overdue:<id>`).
- **User training** (Maintenance › User training, `/assets/training`). A session per device type: date, trainer,
  kind (initial, refresher, by the supplier), department, notes, attendees (PAMS accounts and/or typed
  "Name, Department" lines) and the signed sign-in sheet as an attached document. The department page shows, for each
  device type in the department, who is trained and whose training is older than the set period (Administration ›
  Settings › "User training valid for", default 24 months), and "Nobody trained" where nobody is.
- Demo data (`scripts/seed/maintenance.ts`): usage intervals on ICU ventilators, CT scanners and dialysis machines
  (demo figures, not the makers'), meter readings on ventilators and dialysis machines (one meter replaced), test
  equipment on recent PPM visits, three loans (one overdue), four ICU training sessions (one older than two years).

Not covered:
- No meter reading is asked for when a PPM is completed; record one on the asset page on the day of the visit for an
  exact count (otherwise use is interpolated between readings, or counted from the first reading).
- A reading entered by mistake can't be deleted or edited from the screen.
- Lending a device out doesn't change its status in the register; there is no loan agreement document or approval.
- Training sessions can't be edited or deleted after saving (attendees can be added and removed).
- The usage intervals in the demo are placeholders: set the makers' values per device type.

## Agents

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

## User guide

- **Usage-based PPM.** In the catalogue, open the device type and fill in "Planned maintenance by use" (for example
  every 5000 hours). On each device's page, add meter readings in the Usage panel, ideally at each planned visit.
  If a meter was replaced, tick "The meter was reset or replaced" for the new meter's first reading. The next PPM
  date is the earlier of the months and the usage estimate; "by use" shows beside it on the maintenance list.
- **Test equipment when signing off PPM.** When completing a visit or a work order, tick the analyser or tester you
  used. If its calibration has run out, the visit can't be completed with it: use another one or have it recalibrated
  and update its date on its asset page.
- **Loans.** Assets › Loans and rentals › Record a loan. For a borrowed device, check its maintenance and safety test
  labels before use and record the check on the loan's page. Record the return when it goes back. Overdue loans are
  listed under Overdue and the biomedical engineers get a notification.
- **Training.** Maintenance › User training › Record training: choose the device type, date, trainer and kind, tick
  the people with an account or type the others, save, then attach the signed sheet. The department page shows who
  is trained on each kind of device and who needs a refresher.
