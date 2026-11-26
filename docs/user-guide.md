# Hospital PAMS — User guide (release 3.0, updated for wave 36)

How to do the everyday jobs, by role. Every screen is reached from the menu on the left (the **Menu** button on a
phone). The search box at the top of every page finds equipment, rooms, departments, suppliers, documents and more.

Demo accounts (password `demo1234`): `admin@`, `director@`, `procurement@`, `finance@`, `planner@`, `biomedical@`,
`technician@`, `icu@` (department head), `legal@`, `viewer@` — all `@demo.hpams`.

---

## Everyone

**Report a fault** (any role)
1. Scan the QR label on the device with a phone, or find it with the search box and open it.
2. Press **Report a fault**, describe the problem, say whether the device is down and how urgent it is.
3. Press **Report fault**. The biomedical team is notified; follow the job from the device page or **Work orders**.

**Find a device in the building**
- Search by tag, serial number, maker, model or tag; open it and use **Show in 3D** or **Show on floor map**.
- In **3D view**, a room's details offer **Nearest working device from here**: pick a type (e.g. defibrillator) and
  choose a result to draw the route.

**See what needs attention**
- **Dashboard**: your approvals and alerts. **Notifications** (bell): everything sent to you.
- **Reports › Executive summary**: one page per hospital; **Print or save as PDF**.

**Ask the assistant** (when your administrator has switched it on)
- **Assistant** in the menu: ask in plain words, e.g. *Which ICU devices are out of service?* or *How much of this
  year's capital budget is left?* It looks the answer up in PAMS and only sees what you can see.
- Ask it to draft: *a technical specification for a high-end patient monitor*, *a letter to the supplier of PO-… asking
  for a delivery date*. Values it assumed are in [square brackets]; **Copy** the text into your document.
- It can't change anything, and it can be wrong: check figures before you rely on them. **New chat** starts over.
- Your chats are kept for you only (the last 50) under **Your chats**; open one to carry on, or × to delete it.
  **Download as Word** under an answer (or **Download chat**) gives a .docx to edit and send.

---

## Biomedical engineer

**Run the job list** — **Work orders**
- *Waiting for assignment* tab: open a job, choose the technician and press **Assign job** (later: **Reassign job**).
- KPIs at the top: open jobs, urgent, late (past the response target), response on time, repair time.
- When the technician completes a job, check it and **Sign off and close** (or **Reopen job** with a reason). Record the
  warranty or contract claim on the job with **Update claim**.

**Planned maintenance** — **Maintenance**
1. **Generate schedule** plans visits from each device type's interval; under *Create work orders for scheduled visits*,
   **Create work orders** turns the due visits into jobs carrying the checklist.
2. Edit a device type's checklist on its catalogue page (**Device catalogue** › type › *PPM checklist*), one check per
   line: `description | unit | min | max`.

**Service contracts and warranty claims** — **Service contracts**
- **Add a contract**, then **Add devices** it covers. Each job then shows *warranty*, *contract* or *not
  covered*; record the claim status and reference on the job.
- Add the contract's performance terms (repair time, uptime guarantee, penalties and cap) when editing it; then
  **Monthly statement** prints the response and repair times, uptime and the penalty due, month by month.

**Spare parts** — **Spare parts**
- **Add a part** with its minimum level; on the part, *Receive or correct stock*; technicians **Book part** on a job. Low
  stock notifies you.

**Recalls** — **Recalls**
- **Record a notice** (type, maker, model, serial numbers) → **Record notice and find devices**. Matching devices are
  listed; create an inspection job for each, mark devices actioned or not affected, then **Close recall**. Serial
  ranges are written `SN1000 to SN1999`. **Show … pending in 3D** opens the model with the pending devices highlighted.

**Disposal and replacement**
- From a device: **Propose disposal** → **Submit for approval** → the director approves → **Record as disposed** with the
  method and certificate.
- **Replacement plan**: devices scored for replacement; select them and **Create replacement BOQ**.
- **Capital plan**: the same devices placed by year over 5 or 10 years, per department, against the budget you enter
  for each year. Pick a year, untick what you'll keep, and **Turn the ticked devices into a BOQ**.

**Imaging use** — **Imaging use**
- Enter each scanner's exams for the month (and the hours it was scheduled to run), or paste rows from the RIS:
  `tag, month, exams, hours`. Set each type's planning capacity once. Scanners over capacity get a ready sentence for
  tender justifications.

**Check the drawings** — **Facilities › hospital › Drawing quality**
1. Each floor gets a score out of 100. Open a floor for its issues: rooms with no outline found, rooms split from an
   open area, overlaps, missing layers, scale, alignment, old floors, rooms no door leads to.
2. Fix what you can: re-import the drawing (Update drawings), or fix doors in the 3D view (Routes).
3. After checking a room on the floor, open its data sheet and **Mark as verified on site**.
4. Type each floor's drawing revision so everyone knows which drawing the model is built from.
5. *Symbols read from the drawing* shows the equipment, furniture, fittings and gas outlets the import recognised, and
   the block names it didn't: ask whoever runs the import to add rules for those (tools/cad/README.md).

**Will it fit?** — catalogue and 3D view
- On a make and model's page, **Site planning**: enter the figures from the manufacturer's site planning guide, or
  **Start from typical values** (marked *typical* until you replace them).
- In the 3D view, select a room: **Edit survey** records its ceiling, door, floor load, services and medical gas outlets (blank = not surveyed); **Check a make
  and model** places it at the best spot, draws its footprint, service space and (MRI) 5 gauss line, and lists what
  passes, fails or is still to confirm. **Readiness sheet** prints it for sign-off.

**Keep the register tidy**
- **Device catalogue › Makes and models**: **Add the makes and models in the register** once, then add support dates.
- **Fleet & standardisation**: see how many makes each type has; set the **preferred model** with a reason.
- Tags on a device (*Edit details* › Tags), e.g. `loan, teaching, donated`; click a tag to list every device with it.

**Rounds and stock-take** — **Rounds and stock-take** (on a phone)
- **Start** a round (or a stock-take of a ward), then scan each label or tap it in the list: **OK**, **Fault** (a job
  is raised) or **Moved** (choose the room). No signal? Carry on: results are sent when it returns. **Finish** lists
  what a stock-take didn't find.

**Accept delivered equipment**
- On a delivered device, **Delivery and acceptance**: tick each check, **Sign for biomedical engineering**, then the
  department head signs (or you record who signed for the department). The device goes into service and its warranty
  starts. Set each type's acceptance checks on its catalogue page.

**Open a new building or wing** — **Commissioning**
1. **New commissioning plan**: name it, tick the floors (and, if you like, only some departments), the first handover
   date and the weeks from handover to installed and from installed to accepted. Link the project to see devices still
   on order. Corridors, lifts and stairs are left out; offices, stores and plant rooms start as needing no equipment.
2. **Set a date for a group of rooms**: planned handovers floor by floor or department by department. As the builder
   hands rooms over, record the actual handover (a whole group at once, or room by room in the table).
3. Installed and accepted come from the register: a room counts as installed when every device in it is installed, and
   accepted when every device's acceptance is signed. Rooms behind the plan are shown in red.
4. **Week by week in 3D** plays it on the building; the project's *Commissioning* tab shows the same Gantt.

**Room standards** — **Room standards**
- One data sheet per kind of room: area, ceiling, door, floor load, finishes, gas outlets, power, ventilation. Name
  rules come first (MRI, theatre, isolation…), then room types. **Edit** to change a figure; your first change makes an
  editable copy of the built-in set (draft figures to be confirmed by the engineers).
- Open a standard for its printable sheet and the rooms that follow it, with what each falls short of. Each room's own
  data sheet shows its standard and the comparison.
- Each standard is a **room template**: it also lists the **equipment** the room needs (catalogue code, how many,
  per bed space or per room, clearance around it) and the narrowest **clear width**. Rooms are checked against the
  devices registered in them (*Equipment missing*) and the width of their outline. Templates cover sterile services
  (decontamination, packing and sterilising), triage, dental surgeries and laboratories (clinical, microbiology,
  blood bank) as well as the clinical rooms. If you edited the standards before, **Reset to the built-in
  standards** to get the new templates.
- In 3D, **View › Room templates** colours rooms: short, equipment missing, to survey, meets it. A selected room shows
  its template and what is short. **BOQ › Checks › Room standards** compares the templates' equipment for the
  departments' rooms with the BOQ quantities.

**Register equipment**
- **Asset register** › **Register asset** (one), **Bulk place** (e.g. a monitor at every ICU bed) or **Import Excel**
  (download the template first). Makes and models are offered as you type. To print QR labels, tick devices in the
  register and press **Print labels for selected** (or **Print label** on one device).

---

## Technician

- **Work orders › Assigned to me**: open your job, **Start work**; **Put on hold** with a reason if waiting for parts and
  **Resume work** later; **Book part** for parts used from stock; then **Complete job** with the work done, downtime
  and, for planned maintenance, the checklist results.
- Move a device from its page (**Record movement**), or in 3D (*Move to another room*, *Set exact spot*).
- On a phone, use **My jobs** (see *My jobs on the phone* below).

---

## BOQ planner

**Start a BOQ quickly** — **BOQs › Quick start**
1. Hospital type and ownership, total beds; adjust the ICU/CCU/NICU/isolation beds.
2. Services (and how many theatres, dialysis chairs, deliveries a year, clinics); special conditions (trauma centre…).
3. Price tier and target budget; **Review the BOQ** shows totals at three price tiers and the biggest items.
4. **Create BOQ**. It's a normal draft: every quantity shows its calculation.

**Refine it** (BOQ page)
- *Departments* tab: department sizes, planning answers (exams, deliveries…), price tier per department, features and
  target budget, opening phase.
- *Price scenarios* panel: **Price at basic / standard / premium**. A price you type on a line is kept.
- *Checks* tab: risk flags, **Fit to budget** (review the list, then **Apply these changes**), room requirements against
  the real rooms, **room standards** (each room of the linked departments against the standard for its kind of room:
  open *Rooms below their standard* for the list, each linked to its data sheet), benchmarks.
- *Phasing & costs* tab: opening date and phases, cash flow by quarter, cost of ownership over 5 and 10 years.
- **Submit for approval** when ready; **Export to Excel** any time.

The reference figures behind the checks are listed in `docs/reference-figures-review.xlsx`.

**Simulate the queues** — **Patient pathways › Queue simulation**
1. Publish the pathways with their patients a day and arrival profile; the simulation takes every published one.
2. Choose a day or a week and **Run the simulation**. Red rows are busy above 85 % on average, or one patient in ten
   waits over 30 minutes. Click a resource for its chart by hour.
3. **What-if**: type a new number for any room, scanner, bed group, lift or porters (or patients %), and run again: the
   results show side by side. Ranges are the middle 90 % of the runs.
4. The load figures on **Analysis** stay as the quick check; the simulation adds waits and knock-on effects (more
   theatre capacity fills the ward, for example).
5. Optional, in the boxes under the settings:
   - **Staff on duty**: **Add a staff group**, name it (e.g. Radiographers), say how many are on duty and tick the
     rooms and scanners they work. The group appears in the table, so you can change it in the What-if column.
   - **Opening hours**: choose a room, scanner or staff group and **Set opening hours**; tick *Weekdays only* if it
     closes at weekends. For the what-if, choose *Other hours* (e.g. MRI until 22:00).
   - **Appointment books**: choose a pathway and **Book its patients** from, to, with a no-show share.
   - **What-if: move a step to another floor**: choose the step and the floor.
6. **Save scenario** keeps every setting and the what-if under a name (tick *Share with everyone* to share it).
   Choose it under *Saved scenario* and **Load** it later; **Start again** goes back to the defaults.

---

## Procurement officer

1. **Projects & tenders** › create the project; add specifications per device type.
2. **RFQs** › **New RFQ** from the BOQ, or on the BOQ **Start a tender from this BOQ** (see wave 39 below). Use the
   approved BOQ: the page warns, but does not stop you, when the BOQ isn't approved yet.
3. **Offers**: record each offer and its compliance line by line; **Compare offers** for the weighted score. Add each
   offer's running costs (service after warranty, consumables, energy, other, uptime guarantee) to see the **total
   cost of ownership** over 5 or 10 years, next to what the same models have cost you to maintain.
4. Set up the committees (Law 182); **Recommend award**; the members sign; the director approves.
5. **Purchase orders** from the award → approval → **Issue** after the acceptance notice.
6. **Receive goods** on the PO: each unit becomes a tagged asset. Charge the PO to a **budget line** on its page, and
   **Record invoice** when the supplier bills: it is matched against what was ordered and received.
7. On the project's **Tender** tab: choose one or two envelopes, record the envelopes opened, record bid and
   performance bonds, and print the minutes, the technical evaluation sheet and validity extension letters.
8. **Framework agreements**: record the agreed items and prices once; **Draft call-off PO** whenever you need more.
- Service contracts can also be managed from **Service contracts**.

### Method, timetable and bidder questions (wave 37)

- **Tender** tab › **Procurement method**: choose the method (Law 182/2018 art. 7: public tender, limited tender,
  local tender, two-stage tender, public or limited practice, direct agreement; or a call-off under a framework
  agreement, art. 65). Any method other than a public tender needs the reason and who approved it.
- **Timetable**: a planned and an actual date for each step, from the announcement to the contract. Steps the app
  already knows (RFQ issue and closing, envelopes opened, award approved, complaint period, first purchase order) fill
  the actual date by themselves. **Suggest blank planned dates** fills empty steps from the method's planning days. Days
  are counted from the announcement to the (technical) envelope opening. A date below the legal minimum (public
  tender 20, limited or local tender 14, two-stage 20, public practice 20, limited practice 14) is marked, and PAMS
  never suggests one. A date within the law but under the planning figure gets a softer note. Tick **Urgent** (with
  the reason) under **Change the method** to use the shorter urgent minimums (14 or 10 days).
  Overdue steps reach procurement as alerts. The Overview shows the method, the next step and open questions.
- **RFQ page › Clarifications and addenda**: record each bidder's question (who asked stays inside the hospital),
  the answer and the day it went to all bidders. **Record addendum** numbers it (Addendum 1, 2…); tick "extends the
  submission deadline" to move the RFQ closing date (and the project deadline when it was the same). Nothing can be
  added after the technical envelopes are opened (art. 19). **Notice to all bidders** prints the addenda and answers
  without names; when email is switched on, **Email the notice to all bidders** sends each supplier their own copy.
- Administrators set the planning days per method under **Settings › Tender timetable**; they can't go below the
  legal minimum. The legal figures come from unofficial copies of the regulation: check them against the official
  Gazette.
- **Bid bond**: up to 1.5 % of the tender's estimated value (the project budget, else the linked BOQ), the same for
  every bidder (Law 182 art. 16, Reg. art. 30), not a share of each offer. Under **Bonds and guarantees** enter the
  amount the tender conditions ask for, if it is less; held bonds are checked against it.

---

## Director and Finance

- **Approvals**: everything waiting for you (POs, BOQs, awards, disposals). Approve, or reject with a comment.
- **Budgets** (Finance): add the year's budget lines; you're notified when a PO takes one past 80 % or 100 %.
- **Invoices** (Finance): *To decide* lists matched invoices and those with differences; approve (giving a reason when
  it differs), reject, then **Mark paid**. Three different people are needed: whoever recorded the invoice can't
  approve it, and neither of them can mark it paid. **Export for finance (CSV)** for the accounting system.
- **Exchange rates** (Finance): record the Central Bank rate of each currency, by the date it applies from. Offers are
  converted at their opening date, orders at their order date, purchases at their purchase date; estimates and budgets
  use the latest rate. A rate older than a month is flagged: keep them current.
- **Reports › Executive summary** for each hospital.

---

## Department head and viewer

- Read everything in your hospitals; report faults; follow your department's equipment in the register, floor map
  and 3D view.
- **My department**: pick your department to see its equipment, open jobs, maintenance coming up and devices past
  their service life. **Send request** asks for new or replacement equipment; you're told when the director decides.
- On delivered equipment, **Sign for the department** once biomedical engineering has signed the acceptance checks.
- When an administrator has named the departments you look after, you can edit **patient pathways** whose steps are
  all in your departments, and set the **access zone** of your rooms in the 3D view.

---

## Administrator

- **Backups**: the backup files with their age (a warning when the last database backup is over two days old).
  **Back up now** copies the database (on PostgreSQL with `pg_dump`) and the uploaded files; **Check it opens** tests a
  file; download them to keep a copy off the server. Restoring is in `docs/deploy.md`.
- **Audit log**, **Users** and **Approval rules & settings** (where the assistant is switched on).

---

## Equipment 3D library

- **Catalogue › 3D library** lists the models drawn in 3D: their clear zones, connection points, site data and 3D
  file. **Edit** a model to change its zones (`name, kind, side, depth`) and connections (`kind, name, along, across,
  height`), or upload its own **.glb** file (from the maker's BIM object, SketchUp or Blender). Each model's page
  links here too.
- The figures are typical until you enter the maker's site planning guide; the list says which are typical.
- In 3D, **View › Clearance zones and connections** shows them on the floor shown on its own (or the selected
  device's floor).

## Space planning

- **Facilities › hospital › Space planning**: areas per floor (gross, net, circulation, cores, net-to-gross) and per
  department (net area, largest uses, beds, devices per 100 m², bed places against the room templates).
- Rooms with more beds than their area allows are listed with links to their data sheets.
- **Save a snapshot** before a change; afterwards **Compare with now** (or pick another snapshot as *after*).
- In 3D, Problem layer › **Equipment density** colours rooms (or departments) by devices per 10 m².

## Clash check

- **Facilities › hospital › Clash check** lists, floor by floor, devices out of their room or on top of each other,
  clear zones blocked by a wall or a device, devices in a door's swing, devices taller than the ceiling, rooms too
  full for their clear space, and devices not marked MR-conditional in an MRI's field or room.
- Devices you place on the plan (drag in 3D) get every check; devices only assigned to a room get the ones that need
  no position. Rooms with a guessed outline are skipped for area checks.
- In 3D, **View › Clash check** rings the devices and lists them; click one to fly to it.

## Clinical flow on the model

- 3D view › **Pathways** › **Simulate a week**: rooms, scanner rooms and lifts turn green, yellow or red by how busy
  they are in the queue simulation of the published pathways; click a line in the list to fly there. *On the model*
  switches the colours off. The full simulator (what-ifs, staff, opening hours) is under Patient pathways.
- Show a pathway and tick **Bed and stretcher clearance**: red rings where a bed or trolley route is under 1.2 m
  clear or turns a corner a bed can't, amber where a corridor is under 1.8 m. The pathway's checks list them too.

## Presentation renders and videos

- **Presentation render**: *Textured finishes* and *Light fittings* (soft pools of light where the ceiling lights are)
  are on by default; switch them off for a plain drawing look.
- **Tours › Video** plays a tour and saves it as a video file with the captions, ready for a board meeting. Keep the
  tab in front while it records.

## Safety records (wave 23)

- **Report an incident** from a device's page (or *Maintenance › Incidents*) when a device harms someone, nearly
  does, or behaves dangerously. Look after the patient first, then take the device out of use and keep it as found.
- The biomedical team records the cause, the corrective action and the dates the manufacturer and the EDA were
  told. *Report sheet* prints the record to copy into the EDA's form. Take the time limit for reporting from the
  EDA's medical device vigilance guideline and enter it as *Report to the EDA by*.
- **Risk and strategy** lists every device type the hospital owns with its risk score, how it is maintained and
  why. Press *Score* or *Edit* on a row to fill it in.
- The hospital's own schedule and *Repair when it fails* are refused for imaging and radiation equipment, MRI and
  medical lasers, and for types where a device was installed less than 12 months ago or has fewer than 2 completed
  planned visits (CMS S&C 14-07, Joint Commission). The hospital's own schedule also needs its **evidence and risk
  basis** written down. Administrators change the 12 months and 2 visits under **Settings › Maintenance strategy**.
- **Record a test** on a device's page stores an electrical safety test. Enter the readings; the app says pass or
  fail against the IEC 62353 limits. *Maintenance › Safety tests* shows what is due and what failed.
- Mark the safety analyser as **Test equipment** on its own page and enter when its calibration runs out. A test
  can't be recorded with an analyser that is out of calibration.

## Modules, sorting and saved filters (wave 21)

- **All modules** (in the menu, or the first page after the dashboard) shows one card per module: Planning,
  Procurement, Finance, Assets, Maintenance, Buildings & 3D, Patient pathways, Reports, Administration. You see the
  ones your role can open. Inside a module the menu shows that module's pages.
- The line above each page title shows where you are, for example *Modules › Maintenance › Work orders*. Click a
  part to go back up.
- Press **Ctrl+K** (⌘K on a Mac) and type part of a page's name to jump to it.
- Click a **column heading** to sort a list; click again for the other way, and a third time to clear it.
- Set your filters, then **Save this filter** and give it a name. It appears as a chip above the list on this
  computer; the cross removes it.
- When a form has a mistake, the message shows under the field and the cursor moves there.

## Finding your way (wave 19)

- The side menu puts your own work first. Click a group's name to fold it; hover a link and click ☆ to pin it to the
  top.
- Lists apply a filter as soon as you choose it; remove one with the × on its chip.
- Maintenance › *No PPM on record* lists devices with no visit recorded since installation: record the last visit
  on the asset, or plan the first.

## 3D view: looks and room (wave 22)

- **Presentation** and **Technical** in the top row switch the whole look in one click. Presentation is light with
  built floors, for showing the hospital; Technical is the glowing see-through model, for working in it.
- The app menu is tucked away on this page. **Menu** (top left) brings it back.
- One panel is open on each side; click another panel's header to switch. **Hide panels** clears both sides and
  **Full screen** fills the screen (Esc to leave).
- If the picture stops after the computer sleeps, press **Reload the 3D view**.
- The tools are in two **rails**: Floors, Layers, View, Routes and the rest on the left; Find, Notes, Tours, Views
  and Types on the right. Click a name to open its tool; click it again, or *Close*, to put it away.
- A tall building opens on **one floor**, with the other floors as plain plates. *Floors › Whole building* shows
  them all.
- The **mini-map** (bottom left) shows the floor in plan. The dot is where you are looking; click the map to move
  there. The bar under it gives the scale.
- **Right-click** a device or a room for its actions.

## 3D view in two minutes

- **Imaging** and **ICU** (top bar): every imaging or ICU room tinted and framed, the rest dimmed, with a summary of
  their equipment and the rooms with a device down. Press again, *Clear* or Esc to go back.
- **Floors**: pick one, or *Whole building*. **View**: *Digital twin* or *Architectural* look; *Isometric*, *Plan*, *Eye
  level*; floor spacing; basements; glass façade; *Section cut*; lifts and stairs.
  *Detailed equipment close up* and *Furniture on a floor shown on its own* (illustrative room kits) are on by default.
  *Solid floors (not see-through)*: every floor drawn as a built slab, hiding the floors below.
  *Solid walls (one floor)*: a floor shown on its own has solid walls with door and window openings, as tall as the
  floor-to-floor height; surveyed ceilings show as orange outlines.
- **Problem layer**: faults, overdue maintenance, past service life, downtime, value, recalls — *Heat map* or *Blocks*,
  by room or department.
- **Plan vs installed**: choose a BOQ; missing equipment shows as white wireframes.
- Click a device or room for details and actions. **Views**: save, share, copy link, download an image.
- **Pathways**: tick a published pathway to see it on its walking routes; *Play patients*; the card shows distance,
  time, lift trips and whether the equipment each step needs is working. Show two to compare them, and switch on
  *Corridor traffic*. Lift load is listed under the card.
- **Notes**: select a room or device and *Add a note* (or *Note on a spot*); choose who it's for. Close it when done,
  or turn a device note into a work order.
- **History**: load the last 7–365 days and drag the slider (or *Play*): faults red, repairs green, moves blue,
  installations purple, at each device. *Device status on …* colours every device by its status that day (recorded hourly; days before
  recording began are rebuilt from work orders' downtime).
- **Tours**: *New tour*, set up the model, *Add this view as a stop*, write a caption, save. *Play* runs it full screen
  (← → step, Space pauses, Esc ends); *Copy link* shares it.
- **Walk this floor** (or W): first person on the floor shown. W A S D or arrows, Shift to hurry, drag to look, Esc to
  stop. On a tablet, use the round stick.
- **Move a device by hand**: on a floor shown on its own, press and hold a device, then drag it to a room. *Undo*
  lasts 30 seconds.
- Press **?** for all keyboard shortcuts.

## Audit log, UDI and restore test (wave 24)

- **Admin › Audit log** shows who changed what, when and from which address. For an edit, open *Before and after*
  to see the old and new values. Entries can't be changed or deleted by anyone.
- **UDI**: on a device, *Identity › Edit details*, type the code from the label: the 14 digits after (01), or the
  whole code. The app refuses a code with a wrong check digit. *Software version* is next to it.
- A device with history (moves, maintenance, work orders) can't be deleted. Dispose of it instead.
- **Admin › Backups › Restore test**: press it on a database backup once a month. It loads the backup into a
  scratch copy (never over the live data) and keeps the result. The page warns when a test is overdue.

## Two-step sign-in and device security (wave 25)

**Two-step sign-in.** Open *Your account* (your name, top right) and press *Set up two-step sign-in*. Scan the
square with an authenticator app on your phone, type the 6-digit code it shows, and keep the ten backup codes
somewhere safe. From then on, signing in asks for your password and then a code from the app. Lost your phone? Use a
backup code (each works once), or ask an administrator to reset two-step sign-in for you.

Administrators: *Admin › Settings › Sign-in* sets who must use it. *Admin › Users* shows who has it on; open a user
to reset it when they have a new phone.

**Device security.** On a device's page, *Network and security* records how it connects, its operating system,
whether it holds patient data and when it was last updated. *Maintenance › Device security* lists the recorded
devices and what to check on each, the serious ones first. Start with imaging systems, monitors and analysers.

## Your start page, trends, reports and the phone (wave 26)

**Start page.** After signing in you open the page you use most for your role (for a technician, the work
orders). To change it, open *Your account* and choose under *Start page*. The dashboard is always in the menu.

**Trends.** The dashboard's *Last 12 months* panel shows work orders opened and closed each month, and how much
planned maintenance was done on time.

**Reports.** *Reports* is grouped by subject, with a search box. New: *Work orders and response times*, *Device
incidents* and *Device security*. Each one prints, saves as PDF and exports to Excel.

**On your phone.** Open PAMS in the phone's browser and add it to the home screen (Android: Chrome menu › *Add to
home screen*; iPhone: Safari's share button › *Add to Home Screen*). *Assets › Scan a label* opens a device's page
from its QR label with the camera, on Android and iPhone (from wave 39); you can also type the tag or use a hand
scanner.



## Wave 27: lifecycle records

### Maintenance

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

### Finance

- **Book value of a device**: open the device; the Book value panel is on the right. To change its life or
  residual value, open "Change life or residual value for this device"; leave a field empty to use the device
  type's figure. Set the type's figures on its catalogue page (Depreciation).
- **Book value and COSR reports**: Reports › Money. Choose the hospital (and the period for COSR), then print or
  export to Excel. COSR per year under about 5–6 % is usually good value; it is a guide, not a rule.
- **Budgets in EGP**: Procurement › Budgets shows the year's total in EGP first, then each currency.
- **Supplier documents**: on the supplier page, attach the document, choose its type and the "Valid until"
  date. Use "Change type or date" to fix an existing one. Procurement › Supplier documents lists what has
  expired or expires soon. Procurement is notified 30 days before a document expires.

### Fixes

- **Change your password:** Your account › Change password. Use at least 12 characters; a few unrelated words work well.
- **See where you're signed in:** Your account › Your sessions. Sign out of a browser you don't recognise, or use
  "Sign out everywhere else", then change your password.
- **Set a GMDN code:** Catalogue › open the device type › Edit codes and classification › GMDN code (5 digits) › Save
  codes. The change is in the audit log with the old and new value.
- **Commissioning plan:** open the plan; Progress shows the curve and Gantt; Rooms lets you pick a floor, a department
  and a page of rooms, set dates and save ("Save these 25 rooms"). Save before moving to another page.


## Wave 28: north arrow, own 3D models, simulation shifts

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

## Wave 29: corrections and extras

- **A wrong meter reading**: on the device page, *Usage* › *Recent readings* › *Correct or delete*. When you sign off
  planned maintenance on a device with a meter, type the reading in *Meter reading now*.
- **A wrong training record**: open the session › *Correct or delete this session*.
- **Lending a device out**: record the loan (Assets › Loans and rentals); the device shows *On loan* until you record
  its return.
- **Depreciation**: choose the method in Administration › Settings › Book value. *Reports › Depreciation journal* gives
  the charge for a period, ready to import into the finance system from Excel.
- **Service cost by company**: *Reports › Service cost and COSR* › *By who did the work*.
- **Simulation**: above *Shifts*, *Closed hours* and *Leaving*, choose *The what-if* to set them differently for the
  what-if run. *Also in later queues* lets patients give up while waiting for a later step.

## Wave 37: letters to bidders, comparison in Excel, delay penalties and landed cost

These pages show supplier prices, so only Administrator, Director, Procurement and Finance see them.

### Award and regret letters
- Once the competent authority approves an award, the project's **Committees** and **Tender** tabs show **Letters to
  bidders**, and each offer page has a link to its letter.
- **Award letter** (winning offer): the items, quantities, unit prices and the total awarded value, the committee's
  recommendation and the approval date, the complaint period (Law 182 art. 39) and the performance bond amount.
- **Regret letter** (every other bidder, except withdrawn offers): the items it quoted, the winner, the reason and
  the date complaints close. The reason comes from the evaluation (a failed mandatory item, a partial bid, or its
  rank); change it in the box above the letter before printing. No prices are shown.
- Print on the hospital's letterhead, sign and send.

### Comparison in Excel
- On the **Comparison** tab, **Download comparison (Excel)** gives one sheet: a row per required item, and for each
  offer the unit price, quantity, total (in the tender currency at the price date) and compliance; then net and
  landed totals, scores and ranks.
- For a two-envelope tender whose financial envelopes are still sealed, the file has quantities and compliance only.

### Late delivery penalties
- A purchase order's page shows **Late delivery penalty** (Law 182 art. 48, Reg. art. 98; wave 39). For supply and
  services it goes by the delay as a share of the whole delivery period (order to expected delivery): up to 3 % → 1 %
  of the value, up to 6 % → 2 %, up to 10 % → 3 %, more → 5 %, at most 5 %. For works: 1 % a week or part of a
  week, at most 10 % (15 % when the delay is more than 10 % of the period). Only late units count, unless the order
  says the late part prevents use of what was delivered: then the whole order's value is the basis. Units not
  delivered yet keep adding up (marked "so far") until they arrive.
- Under **Change this order's penalty terms** set the contract type (supply by default), the "prevents use" box, and
  the order's own cap (and weekly rate for works). The hospital rules are under **Approval rules & settings ›
  Delivery penalties and landed cost**; check the figures against the official Gazette.
- **Finance** can **Waive the penalty** with a reason (for example the competent authority's decision). The
  calculation stays on the page, nothing is left to deduct, and the waiver can be taken back.
- **Finance** deducts it on the invoice before approving it: **Deduct delay penalty**. The calculation is kept on
  the invoice, and the invoice shows the amount payable. A penalty is never deducted twice across invoices of the
  same order; enter 0 to remove a deduction. The invoice CSV has the penalty and the amount payable.

### Landed cost by Incoterm
- An offer can carry freight, insurance, customs and duty (%), clearance and local delivery, in the offer currency
  (**Costs on top of the price** on the offer form). Blank means "use the hospital default for the Incoterm"; enter 0
  when a cost doesn't apply.
- The comparison shows a **Landed total** (DDP equivalent) under the net total, with what was added, and a card for
  the **lowest landed cost**. The TCO table shows both the net and the landed price.
- **Rank prices by** (settings) is **Net price** by default. Switching to **Landed cost** makes the financial scores
  and ranks use the landed cost; scores of tenders still being evaluated are refreshed when you save.
## Wave 37: calibration and radiation safety

### Calibration of clinical devices
- Devices whose device type is marked **Needs calibration** (Catalogue › type › Edit codes and classification) are on
  *Maintenance › Calibration*: due, failed, never calibrated, all, and a table **By department**.
- **Compliance** is the share of those devices (installed, in service, under maintenance, out of service or on loan)
  whose last calibration passed and is not past its next due date.
- **Record a calibration** on a device's page: date, result (passed as found, adjusted, failed), who did it, the
  company, the certificate number. It also completes an open calibration visit, or adds one to the maintenance
  history. Attach the certificate on the next page.
- The interval is the device's own (Calibration › Change this device's interval), else the type's (Catalogue ›
  type › Calibration interval), else 12 months.
- **A failed calibration takes the device out of service.** It stays out until a passing calibration is recorded:
  finishing a work order, the status form and Record maintenance can't put it back in service. A pass puts it back
  to the status it had, unless an open job or a disposal still keeps it down.
- Safety analysers and other test equipment keep their calibration date on their own page (Safety tests › Test
  equipment), as before.

### Radiation safety (X-ray, CT, C-arm and other radiation rooms)
- *Maintenance › Radiation safety*, one hospital at a time. Devices count when their type uses ionising radiation:
  X-ray, CT, C-arm and fluoroscopy, mammography, angiography, nuclear medicine, DXA, dental X-ray, radiotherapy.
- **Rooms**: each room with such a device, a licence or protective equipment, and what needs doing (no valid ENRRA
  licence, QC failed or overdue, aprons failed or overdue). A device not in a room is listed under the table.
- **ENRRA licences**: number, room or device, scope, issue and expiry date. Open a licence to attach the scan, or to
  renew it (change the dates). Warnings start 90 days before expiry.
- **Physicist QC**: test, date, physicist, pass or fail and when the next one is due (12 months unless you say).
- **Dosimetry**: one badge reading per person and period, with a name and a role only (no ID numbers). Each reading
  is compared with the period's share of 20 mSv a year; 30 % of that is the investigation level.
- **Protective equipment**: list each apron, collar and shield with its number, then record its checks.
- The device page has a **Radiation safety** panel (its licence and QC); the room data sheet links to the page.

### More alerts
The hourly alert run now also tells the biomedical team about: recalls with devices still to action (daily),
spare parts at or below their reorder level (daily, same alert as when stock drops), safety tests and calibrations
due within 30 days or overdue (technicians too), test equipment whose calibration runs out, ENRRA licences expiring
within 90 days or expired, physicist QC and protective checks due or overdue, and flagged dose readings. More than
three of one kind in a hospital come as one summary.

## Wave 38: covered hours, MRI helium, exam counts and X-ray tubes

### Contract covered hours and public holidays
- Many service contracts guarantee uptime only in agreed hours. On a contract's page, **Covered hours** › *Change
  covered hours*: round the clock, or the days and the times (Cairo time), and whether public holidays count. An end
  time earlier than the start is an overnight shift; it belongs to the day it starts.
- With covered hours set, the **monthly statement** counts uptime and downtime only inside them: two jobs on the same
  outage count once, and an outage at night or at the weekend costs nothing. Response and repair times stay in clock
  hours. A contract with no covered hours works as before (24/7).
- **Public holidays** (*Maintenance › Public holidays*) are kept per hospital. *Add the Egyptian holidays* fills in
  2026–2027, with dates the government moved to a Thursday. Eid and other Islamic holidays are marked
  **approximate**: correct them when the dates are announced. Coptic Easter Sunday is not on the list.

### MRI cryogen log
- *Maintenance › MRI cryogen log* lists every MRI scanner with its helium level, a trend line, the last reading and
  any warning. Record a reading there or on the scanner's page (**Helium and cryogen log**): date, helium %,
  pressure (psi), cold head and compressor state, chiller water temperature, remarks and who read it.
- Warnings (and alerts to biomedical): helium below **70 %**, a fall of more than **2 points in 30 days** (counted
  from the last refill), **no reading for 7 days**, and a cold head stopped or a compressor stopped or in fault at the
  last reading. Each scanner can have its own levels (*Change the warning levels*).
- Open MRIs with a permanent magnet have no helium: they are marked so by default and skipped. Tick
  *Superconducting magnet* if yours has helium.

### Exam counts from the RIS or PACS
- *Assets › Import exam counts*: upload a CSV or Excel export with one row per device and day (or per procedure:
  rows add up). Columns: the device's asset tag or **AE title**, the date, the exam count, and optionally the
  modality and procedure. The preview shows every row with its problems; only good rows are saved.
- Importing a device's day again replaces it. Month totals go into **Imaging use**, so utilisation, exams lost to
  downtime and usage-based PPM use the imported figures. A month typed by hand on Imaging use is replaced the next
  time daily counts for that month are imported.
- Add each scanner's AE title (as set on the scanner) on the import page or on its page. The scanner's page shows
  **Exams**: the last 28 days, per day, per week, the busiest day and 12 weeks of weekly totals.

### X-ray and CT tubes
- CT, X-ray (including C-arm and fluoroscopy), mammography and angiography devices have an **X-ray tube** panel.
  Record the tube in use: serial, fitted on, the counter at fitting, warranty in months and/or use (whichever comes
  first) and expected life. CT counters default to **scan seconds**, the others to **exposures**; mAs and rotations
  can be chosen to match the warranty.
- Record counter readings from the service screen. The panel shows use so far, use per day, the forecast
  replacement date and the warranty end. **Replace the tube** closes the old one (with its last counter and the
  reason) and keeps it in the replacement history with its cost.
- Alerts to biomedical when the forecast replacement is within **8 weeks** or past the expected life, and when the
  tube warranty ends within 8 weeks or has ended.
## Wave 38: Arabic names on letters, budget years, bids from Excel

### Arabic legal names on letters and minutes
- Suppliers, hospitals, committee members and device types can have their official name in Arabic. The field is
  **Legal name in Arabic (for letters)**: on the supplier form, the hospital's page, each committee member (Committees
  tab: **Add Arabic name for the minutes**, or when adding the member) and the device type's catalogue page
  (**Name on letters**). It must be typed in Arabic letters; leave it blank for none.
- The Arabic name prints under the English one on the award, regret and extension letters, the committee minutes
  (suppliers, hospital and signatures) and the purchase order print. The rest of the app stays in English: the
  supplier's page only says whether an Arabic name is given.

### Budget years (July to June)
- Budgets run by budget year, labelled **FY 2026/27** (1 July 2026 to 30 June 2027). The start month is under
  **Approval rules & settings › Book value and budgets › Budget year starts in** (July by default, Egypt's fiscal year).
- A budget line keeps the year its budget year starts in: a line saved for **2026** is **FY 2026/27**. Lines made
  before this change read the same way. With a January start the label is plain **FY 2026**, as before.
- The Budgets page, the budget panel on a purchase order, Finance's budget warnings and the executive summary's
  **Capital budget** tile all use the current budget year (in Cairo time). The maintenance budget and capital plan
  pages under Assets still pick years by number.

### Supplier bids from Excel
- On an RFQ, **Bids in Excel › Download bid template (Excel)** gives a file with a row per item (code, item,
  quantity) and blank columns for unit price, discount, make, model, country of origin, delivery (weeks), warranty
  (months) and remarks; a **Compliance** sheet with each specification line to answer **Yes**, **No** or
  **Partial** with the offered value, a remark and the datasheet page; and a **Read me** sheet. The template has no
  prices. The links under it make it out to one invited supplier.
- **Import a bid from Excel** (procurement): choose the invited supplier and the filled file, then **Check the
  file**. Nothing is saved yet; you see every problem (unknown rows, prices that aren't numbers, bad discounts or
  dates, mandatory lines not answered, a file from another RFQ or supplier) and the lines read. Fix the file and
  check again, then **Import bid**.
- Importing creates a **Received** offer with its lines and compliance answers (delivery: the longest of the items;
  warranty: the shortest; each item's remarks go in the offer notes). Importing again replaces the lines and answers
  of the supplier's offer while it is Received or Under review; a shortlisted or awarded offer is changed on its own
  page.
- Importing is data entry, so it works on a sealed two-envelope tender too, but the check shows prices only to
  people who see supplier prices, and only once the financial envelopes are open.

## Wave 39: data quality and BOQ to tender

### Data quality

- **Reports › Data quality** (also in the Reports menu) checks the records now: devices missing a serial number,
  maker or model, install date, purchase cost, room, criticality or GMDN code; PPM due with no visit planned; the same
  serial on two devices of one maker; devices out of service with no open job; finished jobs without labour hours or
  downtime times; jobs open more than 90 days; orders received 60+ days ago with no invoice; offers with no exchange
  rate; expired contracts still linked to devices in use.
- Each rule shows a severity and a count. Click it for the list of records, each with a link to open and fix it.
- The score per hospital is the share of its devices that pass every high and medium device rule (low ones, like
  the GMDN code, are listed but not scored). Choose a hospital at the top.
- Rules on offers and invoices show only for people who see supplier prices.

### Start a tender from a BOQ

- On a BOQ, **Start a tender from this BOQ** (procurement). Tick lines, or a device type to take all its lines. Lines
  already in an RFQ are shown with its number and not ticked.
- Choose an existing project, or a new one (code and title): a BOQ without a project is linked to it.
- **Create the draft RFQ** makes one RFQ item per device type with the quantities added up and the departments listed.
  Ticked "Start a draft specification…" adds a draft spec from the template for each item the project has none for.
  Then invite suppliers and issue the RFQ from its page.
- The BOQ's **Tender & orders** tab shows plan vs ordered per device type: planned, in an RFQ, ordered, received and
  still to order.

## My jobs on the phone (wave 39)

*Maintenance › My jobs* (technicians land there after signing in) lists your open jobs: repairs first, then planned
maintenance. Tap a job, or press **Scan a device** and point the camera at its label (any phone; the site must use
https for the camera).

- In a job: **Save note**, add **Labour time**, add a **Part used**, and **Complete job** (with the checklist for
  planned maintenance). A job not started yet is started when you complete it.
- **No signal?** Open My jobs once while online and it keeps working offline. Everything you do waits on the phone
  and is sent when you are back online. The top line shows *Offline*, how many changes are *waiting to send*, or
  *All sent*. Each change in a job shows *Queued*, *Synced* or *Conflict*.
- **Conflict** means someone changed the job after you opened it (for example the lead put it on hold or gave it to
  someone else). Nothing is overwritten. The job shows what it says now; choose **Send mine anyway** or **Drop
  mine**.
- Test equipment and meter readings are recorded on the full job page (needs signal).
- Signing out removes the kept jobs from the phone. Changes not yet sent stay and go out when you sign in again.

## Analytics: cost and procurement (wave 40)

Both tabs are for people who may see prices (Admin, Director, Procurement, Finance). Pick the hospital and period at
the top. Every figure shows how it is worked out, its period and how many items it rests on.

### Cost

- **Ordered** counts approved and issued purchase orders by order date; **Invoiced** counts invoices that were not
  rejected, by invoice date. Each amount is in EGP at the exchange rate of its own date.
- Choose how to group: supplier, device category, department, year or currency. The 10 largest are shown; the rest
  are added up as Other.
- **COSR by device type** comes from the service cost report (Reports › Service cost and COSR). Open the report for
  departments, suppliers and the Excel file.

### Procurement

- **Tender competition**: bids per RFQ, the share of RFQs with a single bid (10 % or less is good, over 20 % is poor),
  RFQs with no offers, and days from the RFQ's issue to the award (aim for 120 or less), by method and category.
- **Prices against earlier prices paid**: for each device type and model, the median and range of prices on orders
  and awarded offers. Shown only with 5 or more prices. An offer far above them is listed, and its tender's comparison
  shows a "Well above earlier prices" badge on that offer. Check the offer before you decide; it may include more.
- **Supplier scorecard**: on-time delivery, average delay, penalties deducted, devices with a repair within 90 days
  of installation, uptime targets met under service contracts, response time and awards. Suppliers are ranked only
  when 5 or more of their orders were due in the period.
