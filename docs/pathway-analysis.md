# Pathway analysis — how the figures are worked out

Wave 7, step 7d. Every figure is an **estimate** from the published pathways (Planning › Patient pathways), the
hospital's rooms and the devices in the asset register. On screen, hover over or focus a figure to see its working.
Where to find them:

| Figure | Where |
|---|---|
| Room load, beds needed, scanner load, equipment readiness | Planning › Patient pathways › **Analysis** (and *Download Excel*) |
| Distance, time, floor changes, lift trips per patient; lift load; corridor traffic; compare | 3D view › **Pathways** panel |
| Pathways missing working equipment | Dashboard, *Patient pathways at risk* |

## The figures

**Patients at a step.** The daily volume enters at the start step(s) and splits along the arrows by their shares. A
loop (back to CT, say) is followed until the numbers settle.

**Room load at the busiest hour.** For each hour of the day: patients arriving that hour (daily volume × the arrival
profile's share for that hour) × minutes at the step ÷ 60. That is the average number of patients there at once
(Little's law). It is summed over all pathways using the place, and the busiest hour is divided by the number of rooms:
the step's own room, or the department's care rooms (patient rooms, wards, ICU bays, theatres, procedure, imaging and
consultation rooms). **Flag above 85 %.** Simplification: a patient is counted at every step in the hour they arrive,
so later steps' peaks are approximate.

**Beds needed.** For stays of 12 hours or more: patients a day × days in bed = beds occupied on average. Compared with
the beds registered in the department (device types `FUR-BED…`), or its bed rooms when no beds are registered. Only
the pathways' own patients are counted; other admissions use the same beds.

**Scanner load.** Exams a year (patients a day at the step × 365) against devices of that kind in the step's room (or
department) × yearly capacity per device: CT 12,000, MRI 6,000, X-ray 10,000, ultrasound 6,000 (the same reviewed
figures the BOQ questions use). **Flag above 85 %.**

**Per patient (3D card).** Each arrow's route counts by the share of patients taking it: distance, time moving (walking
pace by transport, lift wait 45 s and 8 s a storey), floor changes and lift trips; time in care adds each step's
minutes × the patients reaching it.

**Lift load (3D).** For each lift: trips in the busiest hour (patients a day on each arrow that rides it × the
pathway's busiest-hour share) × round trip, divided by cars × 3600 s. Round trip = 2 × 20 s doors + 2 × loading (bed
60 s, wheelchair 30 s, on foot 15 s) + 2 × 8 s per storey. **Flag above 70 %** — waiting rises sharply above it.

**Corridor traffic (3D).** Each walk leg is sampled every metre; every 2 m cell it crosses adds that leg's patients a day
once. Shown blue (few) to red (busiest).

**Equipment readiness.** For each step, the device types it needs (codes such as `IMG-CT-128`, or a group such as
`LIF-VEN`): found in its room, else in its department; *ready* when at least one is in service or installed. Live in
the 3D view (refreshed every minute).

Queue simulation (waiting times) is out of scope: a load above the flag is the signal to look closer.

## Worked example

The unit tests (`src/lib/flows/analysis.test.ts`) check exactly these numbers.

An outpatient pathway, **24 patients a day**, half of them arriving between 10:00 and 11:00 and the rest spread over the
other 23 hours:

```
Arrival → Clinic (30 min, department with 2 exam rooms and an office)
          ├─ 50 % → CT (20 min, room CT 1 with one CT scanner)
          │         ├─ 25 % → Ward (2 days, department with 1 registered bed)
          │         └─ 75 % → Discharge
          └─ 50 % → Discharge
```

| Figure | Working | Result |
|---|---|---|
| Patients at CT | 24 × 50 % | 12 a day |
| Clinic at 10:00 | 24 × 0.5 = 12 arrivals × 30 min ÷ 60 = 6 at once ÷ 2 exam rooms (the office doesn't count) | **300 %, flagged** |
| CT room at 10:00 | 12 × 0.5 = 6 × 20 ÷ 60 = 2 at once ÷ 1 room | **200 %, flagged** |
| Ward beds | 12 × 25 % = 3 a day × 2 days | **6 beds needed, 1 registered — short** |
| CT scanner | 12 × 365 = 4,380 exams ÷ (1 × 12,000) | 36.5 %, fine |
| A bed lift, 4 storeys | round trip 2×20 + 2×60 + 2×4×8 = 224 s; 30 trips a day, 10 % in the busiest hour = 3 trips × 224 s = 672 s ÷ 3600 s | 18.7 %, fine |

The CT scanner has plenty of capacity over a year, yet the CT room is overloaded at 10:00: half the day's patients
arrive in one hour. Spreading the clinic's appointments, not buying a scanner, is the fix this points to.
