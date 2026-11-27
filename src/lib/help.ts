/**
 * Task guides for the help page (wave 41): short numbered steps with links into the app. Pure data and helpers, so
 * the page, its search and the test agree. `need` lists every permission the task needs: a guide shows only when the
 * user's role holds all of them. Links are app routes (a query string is allowed); `help.test.ts` checks each one
 * against the pages in src/app.
 */
import type { Permission } from "./auth/permissions";

export type HelpStep = { text: string; href?: string; link?: string };
export type HelpGuide = { id: string; title: string; summary: string; need: Permission[]; keywords: string[]; steps: HelpStep[] };

export const HELP_GUIDES: HelpGuide[] = [
  {
    id: "plan-department", title: "Plan equipment for a new department",
    summary: "Build a bill of quantities (BOQ) from beds and rooms, check it and send it for approval.",
    need: ["boq.edit"], keywords: ["boq", "bill of quantities", "planning", "quick start", "budget", "beds", "new wing"],
    steps: [
      { text: "Start with Quick start: hospital type, beds, services and price tier. Or start a blank BOQ.", href: "/boq/quick-start", link: "Quick start" },
      { text: "On the BOQ's Departments tab, set each department's size and answers. Every quantity shows how it was worked out.", href: "/boq", link: "BOQs" },
      { text: "Use a room kit for rooms that repeat (an ICU bed space, a theatre).", href: "/boq/room-kits", link: "Room kits" },
      { text: "Open the Checks tab: risk flags, Fit to budget and room standards." },
      { text: "Press Submit for approval. Export to Excel at any time." },
    ],
  },
  {
    id: "run-tender", title: "Run a tender under Law 182",
    summary: "From the project and specifications to the RFQ, bidder questions and offers.",
    need: ["procurement.edit"], keywords: ["tender", "law 182", "rfq", "specification", "procurement", "bid bond", "envelopes", "timetable"],
    steps: [
      { text: "Create the project and add a specification for each device type.", href: "/procurement/new", link: "New project" },
      { text: "On the project's Tender tab, choose the method, one or two envelopes, and plan the timetable." },
      { text: "Make the RFQ from the approved BOQ (on the BOQ: Start a tender from this BOQ), or start a new RFQ.", href: "/procurement/rfqs/new", link: "New RFQ" },
      { text: "Record bidder questions and addenda on the RFQ page; print the notice to all bidders.", href: "/procurement/rfqs", link: "RFQs" },
      { text: "Record the envelopes opened and the bid bonds on the Tender tab.", href: "/procurement", link: "Projects & tenders" },
    ],
  },
  {
    id: "award-po", title: "Award and issue a PO",
    summary: "Compare offers, recommend the award, get it approved and issue the purchase order.",
    need: ["prices.view", "po.create"], keywords: ["award", "purchase order", "po", "offers", "compare", "committee", "approval", "issue"],
    steps: [
      { text: "Record each offer and its compliance line by line.", href: "/procurement/offers", link: "Offers" },
      { text: "Press Compare offers on the project for the weighted score and the total cost of ownership." },
      { text: "Recommend award. The committee members sign and the director approves.", href: "/approvals", link: "Approvals" },
      { text: "Create the purchase order from the award and send it for approval.", href: "/procurement/purchase-orders/new", link: "New purchase order" },
      { text: "Once approved, press Issue on the PO.", href: "/procurement/purchase-orders", link: "Purchase orders" },
    ],
  },
  {
    id: "receive-accept", title: "Receive and accept a device",
    summary: "Receive goods on the PO, then sign the acceptance checks so the device goes into service.",
    need: ["goods.receive"], keywords: ["receive", "delivery", "acceptance", "commissioning", "warranty", "goods", "asset"],
    steps: [
      { text: "Open the PO and press Receive goods. Each unit becomes a tagged device in the register.", href: "/procurement/purchase-orders", link: "Purchase orders" },
      { text: "Print QR labels: tick the devices in the register and press Print labels for selected.", href: "/assets", link: "Asset register" },
      { text: "On the device, open Delivery and acceptance and tick each check." },
      { text: "Sign for biomedical engineering; then the department head signs. The warranty starts." },
    ],
  },
  {
    id: "report-fault", title: "Report a fault",
    summary: "Tell the biomedical team a device is not working.",
    need: ["workorders.report", "assets.view"], keywords: ["fault", "broken", "repair", "work order", "job", "down", "qr", "scan"],
    steps: [
      { text: "Scan the QR label on the device with your phone, or find it with the search box.", href: "/scan", link: "Scan a label" },
      { text: "Press Report a fault. Say what is wrong, whether the device is down and how urgent it is." },
      { text: "Or report it from the work orders page without the device open.", href: "/assets/work-orders/new", link: "New work order" },
      { text: "Follow the job on the device page or in Work orders.", href: "/assets/work-orders", link: "Work orders" },
    ],
  },
  {
    id: "close-job-phone", title: "Close a job on the phone",
    summary: "Work your jobs on a phone, with or without signal.",
    need: ["maintenance.edit"], keywords: ["my jobs", "phone", "technician", "offline", "complete", "labour", "parts", "checklist"],
    steps: [
      { text: "Open My jobs (open it once while online to keep it offline).", href: "/assets/my-jobs", link: "My jobs" },
      { text: "Tap the job, or press Scan a device and point the camera at its label." },
      { text: "Add a note, labour time and any part used." },
      { text: "Press Complete job (fill the checklist for planned maintenance, and the failure code for a repair)." },
      { text: "Changes made offline are sent when you are back online. On a conflict, choose Send mine anyway or Drop mine." },
    ],
  },
  {
    id: "plan-ppm", title: "Plan PPM",
    summary: "Plan the planned preventive maintenance visits and turn them into jobs.",
    need: ["maintenance.edit"], keywords: ["ppm", "planned maintenance", "preventive", "schedule", "checklist", "interval"],
    steps: [
      { text: "Set each device type's checklist and interval on its catalogue page.", href: "/catalogue", link: "Device catalogue" },
      { text: "On Planned maintenance, press Generate schedule.", href: "/assets/maintenance", link: "Planned maintenance" },
      { text: "Under Create work orders for scheduled visits, press Create work orders." },
      { text: "Check the risk and strategy page for each type's maintenance strategy.", href: "/assets/maintenance/strategy", link: "Risk and strategy" },
    ],
  },
  {
    id: "gahar", title: "Prepare for a GAHAR survey",
    summary: "Check the evidence for the medical equipment standards and fill the gaps.",
    need: ["reports.view", "assets.view"], keywords: ["gahar", "accreditation", "survey", "evidence", "equipment plan", "calibration", "safety tests", "training"],
    steps: [
      { text: "Open the GAHAR evidence pack, pick the hospital and the period.", href: "/reports/gahar", link: "GAHAR evidence" },
      { text: "For each item marked Partly or Missing, follow its link to the records." },
      { text: "Approve this year's equipment management plan.", href: "/assets/equipment-plan", link: "Equipment plan" },
      { text: "Bring calibration, safety tests and user training up to date.", href: "/assets/calibration", link: "Calibration" },
      { text: "Print the pack, or export it to Excel." },
    ],
  },
  {
    id: "analytics", title: "Read the Analytics",
    summary: "Uptime, PPM on time, cost and more, each with its formula and count.",
    need: ["reports.view"], keywords: ["analytics", "kpi", "uptime", "mtbf", "mttr", "cosr", "figures", "dashboard"],
    steps: [
      { text: "Open Analytics and choose the hospital, department, device type and period. Press Apply filters.", href: "/analytics", link: "Analytics" },
      { text: "Each figure shows how it is worked out, the period and n (how many items it rests on)." },
      { text: "Open the Maintenance tab for uptime, MTBF, MTTR and repeat failures.", href: "/analytics/maintenance", link: "Maintenance tab" },
      { text: "Save the filters you use often with Save this filter, or bookmark the address." },
    ],
  },
  {
    id: "data-quality", title: "Check data quality",
    summary: "Find records with missing or doubtful details and fix them.",
    need: ["reports.view"], keywords: ["data quality", "missing", "serial", "duplicates", "clean", "score"],
    steps: [
      { text: "Open Data quality and choose a hospital.", href: "/reports/data-quality", link: "Data quality" },
      { text: "Each rule shows a severity and a count. Click it for the list of records." },
      { text: "Open each record from the list and fix it. The score goes up as devices pass the rules." },
    ],
  },
  {
    id: "radiation", title: "Record radiation safety",
    summary: "ENRRA licences, physicist QC, dose readings and protective equipment.",
    need: ["assets.view", "maintenance.edit"], keywords: ["radiation", "enrra", "licence", "dosimetry", "dose", "apron", "physicist", "qc", "x-ray", "ct"],
    steps: [
      { text: "Open Radiation safety and choose the hospital.", href: "/assets/radiation", link: "Radiation safety" },
      { text: "Add each room's ENRRA licence with its dates; attach the scan on the licence page." },
      { text: "Record the physicist QC: test, date, pass or fail, next due." },
      { text: "Record dose readings per person and period, and check aprons, collars and shields." },
      { text: "For imaging image-quality tests, use Imaging QC.", href: "/assets/imaging-qc", link: "Imaging QC" },
    ],
  },
  {
    id: "backup", title: "Back up and restore",
    summary: "Copy the database and files, check the copy opens, and keep it off the server.",
    need: ["users.manage"], keywords: ["backup", "restore", "database", "files", "pg_dump", "copy"],
    steps: [
      { text: "Open Backups. A warning shows when the last database backup is over two days old.", href: "/admin/backups", link: "Backups" },
      { text: "Press Back up now to copy the database and the uploaded files." },
      { text: "Press Check it opens to test a backup file." },
      { text: "Download the files and keep a copy off the server." },
      { text: "To restore, follow docs/deploy.md (Restore)." },
    ],
  },
];

/** Guides this role can follow: every permission in `need` is held. */
export function guidesFor(perms: readonly Permission[]): HelpGuide[] {
  const have = new Set(perms);
  return HELP_GUIDES.filter((g) => g.need.every((p) => have.has(p)));
}

/** Guides matching every word of `q` (title, summary, keywords and steps; case ignored). An empty query keeps all. */
export function searchGuides(guides: HelpGuide[], q: string): HelpGuide[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return guides;
  return guides.filter((g) => {
    const text = [g.title, g.summary, ...g.keywords, ...g.steps.map((s) => `${s.text} ${s.link ?? ""}`)].join(" ").toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** Every link in the guides, for the route test. */
export const helpLinks = (): string[] => HELP_GUIDES.flatMap((g) => g.steps.flatMap((s) => (s.href ? [s.href] : [])));
