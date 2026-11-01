# Hospital PAMS — User guide (release 3.0)

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

**Spare parts** — **Spare parts**
- **Add a part** with its minimum level; on the part, *Receive or correct stock*; technicians **Book part** on a job. Low
  stock notifies you.

**Recalls** — **Recalls**
- **Record a notice** (type, maker, model, serial numbers) → **Record notice and find devices**. Matching devices are
  listed; create an inspection job for each, mark devices actioned or not affected, then **Close recall**.

**Disposal and replacement**
- From a device: **Propose disposal** → **Submit for approval** → the director approves → **Record as disposed** with the
  method and certificate.
- **Replacement plan**: devices scored for replacement; select them and **Create replacement BOQ**.

**Keep the register tidy**
- **Device catalogue › Makes and models**: **Add the makes and models in the register** once, then add support dates.
- **Fleet & standardisation**: see how many makes each type has; set the **preferred model** with a reason.
- Tags on a device (*Edit details* › Tags), e.g. `loan, teaching, donated`; click a tag to list every device with it.

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

---

## Procurement officer

1. **Projects & tenders** › create the project; add specifications per device type.
2. **RFQs** › **New RFQ** from the approved BOQ (items and quantities are frozen).
3. **Offers**: record each offer and its compliance line by line; **Compare offers** for the weighted score.
4. Set up the committees (Law 182); **Recommend award**; the members sign; the director approves.
5. **Purchase orders** from the award → approval → **Issue** after the acceptance notice.
6. **Receive goods** on the PO: each unit becomes a tagged asset.
- Service contracts can also be managed from **Service contracts**.

---

## Director and Finance

- **Approvals**: everything waiting for you (POs, BOQs, awards, disposals). Approve, or reject with a comment.
- **Reports › Executive summary** for each hospital.

---

## Department head and viewer

- Read everything in your hospitals; report faults; follow your department's equipment in the register, floor map
  and 3D view.

---

## 3D view in two minutes

- **Floors**: pick one, or *Whole building*. **View**: *Digital twin* or *Architectural* look; *Isometric*, *Plan*, *Eye
  level*; floor spacing; basements; glass façade; *Section cut*; lifts and stairs.
- **Problem layer**: faults, overdue maintenance, past service life, downtime, value, recalls — *Heat map* or *Blocks*,
  by room or department.
- **Plan vs installed**: choose a BOQ; missing equipment shows as white wireframes.
- Click a device or room for details and actions. **Views**: save, share, copy link, download an image.
