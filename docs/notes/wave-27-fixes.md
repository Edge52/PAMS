# Wave 27 fixes

## Changelog

- **Password rule.** New passwords need at least 12 characters, may not be one of the most common passwords (also with
  digits or symbols around them, e.g. `Password123!`), may not repeat one character or a short pattern, and may not
  contain the person's email name. The rule is shown beside the field at setup, in Your account (change password) and
  in Administration › Users (new user, reset password). It applies only when a password is set or changed: people with
  older, shorter passwords still sign in, and the demo accounts keep `demo1234` (the seed hashes it directly).
- **Your sessions.** Your account lists where you are signed in: browser ("Chrome on Windows"), when signed in, last
  used and the address. This browser is marked. "Sign out" ends one session; "Sign out everywhere else" ends all but
  this one. Sessions now store only a short browser label (not the whole user-agent string) and the address
  (`sessions.ip`, migration `session_details`).
- **Before-and-after values in the audit trail** for: suppliers (details and active switch), purchase order header
  (dates, terms, notes; changed lines are counted), device types (risk and strategy, codes and classification), users
  (administrator edits, including the hospitals they may see), rooms (room form and room site survey; new rooms are
  now logged too), service contracts, budget lines. Saving a contract, budget line or device type with nothing changed
  says "Nothing changed" and logs nothing.
- **Budget lines:** editing an existing line now also checks access to the line's own hospital (before, only the
  hospital chosen in the form was checked).
- **GMDN code.** Catalogue › a device type › "Edit codes and classification" (needs `catalogue.edit`): GMDN code
  (5 digits, checked), GMDN term, UMDNS code, risk class, criticality, life expectancy, needs calibration. New
  equipment takes the new criticality and life; equipment already registered keeps its own.
- **Commissioning plan split up.** Tabs: Progress (curve and Gantt), Rooms, Dates for a group, Plan settings. The room
  table shows one floor, optionally one department, 25 rooms a page (about 130 fields instead of about 650). Saving
  returns to the same floor, department and page. Changing a field and then following a link asks "Leave without
  saving?"; closing or reloading the tab gets the browser's question. Gantt rows link to their floor and department.
- **Small click targets.** See the agent report: axe-core's WCAG 2.5.8 rule finds none on the pages checked; the
  commissioning check boxes were enlarged to 24 px.

Not covered:
- The common-password list is short (about 120 entries), built in; there is no check against breach databases.
- Older sessions keep their full user-agent string until they expire (at most 7 days); the page shows a label for both.
- The address is the first `X-Forwarded-For` hop, as in the audit log; behind no proxy it is empty.
- Audit diffs are not added to checklists, room zones/workshop flags, drawing verification or the BOQ, which were not
  in scope. The plan settings form of a commissioning plan is still logged without a diff.
- The leave warning clears when a form is submitted, even if the server then refuses it.

## Agents

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

## User guide

- **Change your password:** Your account › Change password. Use at least 12 characters; a few unrelated words work well.
- **See where you're signed in:** Your account › Your sessions. Sign out of a browser you don't recognise, or use
  "Sign out everywhere else", then change your password.
- **Set a GMDN code:** Catalogue › open the device type › Edit codes and classification › GMDN code (5 digits) › Save
  codes. The change is in the audit log with the old and new value.
- **Commissioning plan:** open the plan; Progress shows the curve and Gantt; Rooms lets you pick a floor, a department
  and a page of rooms, set dates and save ("Save these 25 rooms"). Save before moving to another page.
