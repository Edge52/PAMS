# Hospital PAMS — User guide (release 3.0, updated for wave 14)

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

**Will it fit?** — catalogue and 3D view
- On a make and model's page, **Site planning**: enter the figures from the manufacturer's site planning guide, or
  **Start from typical values** (marked *typical* until you replace them).
- In the 3D view, select a room: **Edit survey** records its ceiling, door, floor load and services; **Check a make
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
  the real rooms, benchmarks.
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

---

## Procurement officer

1. **Projects & tenders** › create the project; add specifications per device type.
2. **RFQs** › **New RFQ** from the approved BOQ (items and quantities are frozen).
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

---

## Director and Finance

- **Approvals**: everything waiting for you (POs, BOQs, awards, disposals). Approve, or reject with a comment.
- **Budgets** (Finance): add the year's budget lines; you're notified when a PO takes one past 80 % or 100 %.
- **Invoices** (Finance): *To decide* lists matched invoices and those with differences; approve (giving a reason when
  it differs), reject, then **Mark paid**. **Export for finance (CSV)** for the accounting system.
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

## 3D view in two minutes

- **Floors**: pick one, or *Whole building*. **View**: *Digital twin* or *Architectural* look; *Isometric*, *Plan*, *Eye
  level*; floor spacing; basements; glass façade; *Section cut*; lifts and stairs.
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
  installations purple, at each device.
- **Tours**: *New tour*, set up the model, *Add this view as a stop*, write a caption, save. *Play* runs it full screen
  (← → step, Space pauses, Esc ends); *Copy link* shares it.
- **Walk this floor** (or W): first person on the floor shown. W A S D or arrows, Shift to hurry, drag to look, Esc to
  stop. On a tablet, use the round stick.
- **Move a device by hand**: on a floor shown on its own, press and hold a device, then drag it to a room. *Undo*
  lasts 30 seconds.
- Press **?** for all keyboard shortcuts.
