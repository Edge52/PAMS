/**
 * The app's hubs (wave 21 modules, regrouped in wave 42): each page belongs to one hub. The side menu shows one hub
 * at a time with its main pages (`menu: true`); every page of a hub, menu or not, is listed with a line about it on
 * the hub's own page, `/modules/<id>`. Pure data and helpers, so the menu, the hub pages, the modules page, the path
 * bar and the command palette agree. A new page goes in one hub's section here (see AGENTS.md).
 */
import type { Permission } from "@/lib/auth/permissions";
import type { IconName } from "@/components/ui/icons";

export type NavLink = { href: string; label: string; need?: Permission; flag?: "assistant" };
/** A page as listed on its hub page; `menu` puts it in the side menu too. */
export type HubPage = NavLink & { about: string; menu?: boolean };
export type HubSection = { title: string; pages: HubPage[] };
export type ModuleId = "plan" | "buy" | "pay" | "equipment" | "maintain" | "safety" | "buildings" | "reports" | "setup";
export type Hub<Id extends string = string> = { id: Id; name: string; description: string; icon: IconName; sections: HubSection[] };
export type AppModule = Hub<ModuleId> & { links: NavLink[] };

const link = ({ href, label, need, flag }: HubPage): NavLink => ({ href, label, ...(need ? { need } : {}), ...(flag ? { flag } : {}) });
const menuOf = (h: Hub): NavLink[] => h.sections.flatMap((s) => s.pages.filter((p) => p.menu).map(link));

/** Home: the links shown above every hub's menu, and the personal pages listed on the Home hub page. */
export const HOME: Hub<"home"> = {
  id: "home", name: "Home", description: "The dashboard, approvals, your notifications and account, help and search.", icon: "home", sections: [
    { title: "Start here", pages: [
      { href: "/", label: "Dashboard", about: "Today's figures and what needs you.", menu: true },
      { href: "/modules", label: "All modules", about: "Every hub, with its main pages.", menu: true },
      { href: "/approvals", label: "Approvals", about: "Requests waiting for your decision.", menu: true },
      { href: "/assistant", label: "Assistant", about: "Ask about your data in plain words.", flag: "assistant", menu: true },
    ] },
    { title: "You", pages: [
      { href: "/notifications", label: "Notifications", about: "Alerts and notices for you." },
      { href: "/account", label: "Your account", about: "Name, password, theme and start page." },
      { href: "/account/notifications", label: "Notification choices", about: "In app, email, both or off, per kind of notice." },
      { href: "/account/two-step", label: "Two-step sign-in", about: "Turn on a code from your phone." },
    ] },
    { title: "Find", pages: [
      { href: "/search", label: "Search", about: "Search assets, tenders, suppliers and more." },
      { href: "/help", label: "Help", about: "Step-by-step guides for everyday jobs." },
    ] },
  ],
};

/** Links shown above every hub's menu. */
export const OVERVIEW: NavLink[] = menuOf(HOME);

const HUBS: Hub<ModuleId>[] = [
  { id: "plan", name: "Plan", icon: "planning", description: "Equipment lists from beds and rooms, the capital plan and opening a new wing.", sections: [
    { title: "Equipment lists (BOQ)", pages: [
      { href: "/boq", label: "BOQs", need: "boq.view", about: "Bills of quantities per project and department.", menu: true },
      { href: "/boq/quick-start", label: "BOQ quick start", need: "boq.view", about: "Build a first BOQ from beds and rooms in a few steps." },
      { href: "/boq/standards", label: "Standards & ratios", need: "boq.view", about: "Devices per bed or room that BOQs are built from.", menu: true },
      { href: "/boq/room-kits", label: "Room kits", need: "boq.view", about: "Ready sets of devices for each room type.", menu: true },
    ] },
    { title: "Long-term plan", pages: [
      { href: "/assets/capital-plan", label: "Capital plan", need: "assets.view", about: "Purchases planned by year.", menu: true },
      { href: "/assets/replacement", label: "Replacement plan", need: "assets.view", about: "Devices due for replacement, by score.", menu: true },
      { href: "/assets/commissioning", label: "Commissioning", need: "assets.view", about: "Opening a new wing: devices to install and accept.", menu: true },
    ] },
  ] },
  { id: "buy", name: "Buy", icon: "procurement", description: "Tenders under Law 182/2018, from specifications to award and purchase order.", sections: [
    { title: "Tenders", pages: [
      { href: "/procurement", label: "Projects & tenders", need: "procurement.view", about: "Each project from specification to award.", menu: true },
      { href: "/procurement/rfqs", label: "RFQs", need: "procurement.view", about: "Requests for quotation sent to suppliers.", menu: true },
      { href: "/procurement/offers", label: "Offers", need: "prices.view", about: "Supplier offers and their comparison.", menu: true },
      { href: "/procurement/purchase-orders", label: "Purchase orders", need: "procurement.view", about: "Orders, deliveries and goods received.", menu: true },
    ] },
    { title: "Suppliers", pages: [
      { href: "/procurement/suppliers", label: "Suppliers", need: "procurement.view", about: "Supplier records and their ratings.", menu: true },
      { href: "/procurement/suppliers/documents", label: "Supplier documents", need: "procurement.view", about: "Licences and certificates, with expiry dates.", menu: true },
    ] },
  ] },
  { id: "pay", name: "Pay", icon: "finance", description: "Budgets, invoices with three-way match, framework agreements and exchange rates.", sections: [
    { title: "Money", pages: [
      { href: "/procurement/budgets", label: "Budgets", need: "prices.view", about: "Budget lines and what is committed and spent.", menu: true },
      { href: "/procurement/invoices", label: "Invoices", need: "prices.view", about: "Supplier invoices with three-way match.", menu: true },
      { href: "/procurement/frameworks", label: "Framework agreements", need: "prices.view", about: "Agreed prices to order from without a new tender.", menu: true },
      { href: "/assets/maintenance/budget", label: "Maintenance budget", need: "assets.view", about: "Maintenance spending against its budget.", menu: true },
      { href: "/procurement/exchange-rates", label: "Exchange rates", need: "procurement.view", about: "Rates used to show prices in EGP." },
    ] },
  ] },
  { id: "equipment", name: "Equipment", icon: "assets", description: "The equipment register, labels, requests, rounds, loans and disposals.", sections: [
    { title: "Register", pages: [
      { href: "/assets", label: "Asset register", need: "assets.view", about: "Every device, with filters and export.", menu: true },
      { href: "/assets/department", label: "My department", need: "assets.view", about: "Your department's devices and open jobs.", menu: true },
      { href: "/scan", label: "Scan a label", need: "assets.view", about: "Open a device from its QR label.", menu: true },
      { href: "/catalogue", label: "Device catalogue", need: "assets.view", about: "Device types with life, risk and checks.", menu: true },
      { href: "/catalogue/models", label: "Makes and models", need: "assets.view", about: "Makers' models linked to device types." },
      { href: "/catalogue/library", label: "Equipment 3D library", need: "assets.view", about: "3D shapes used for devices in the 3D view." },
    ] },
    { title: "Add and change many", pages: [
      { href: "/assets/import", label: "Import assets", need: "assets.edit", about: "Add many devices from an Excel sheet." },
      { href: "/assets/bulk", label: "Bulk placement", need: "assets.edit", about: "Spread many units across rooms at once." },
      { href: "/assets/labels", label: "Asset labels", need: "assets.view", about: "Print QR labels on A4 sheets." },
    ] },
    { title: "Life of a device", pages: [
      { href: "/assets/requests", label: "Equipment requests", need: "assets.view", about: "Departments ask for new or extra devices.", menu: true },
      { href: "/assets/rounds", label: "Rounds and stock-take", need: "assets.view", about: "Check devices are where the register says.", menu: true },
      { href: "/assets/loans", label: "Loans and rentals", need: "assets.view", about: "Devices lent, borrowed or rented.", menu: true },
      { href: "/assets/disposals", label: "Disposals", need: "assets.view", about: "Taking devices out of service for good.", menu: true },
    ] },
    { title: "Use and fleet", pages: [
      { href: "/assets/fleet", label: "Fleet & standardisation", need: "assets.view", about: "Makes and models per device type, to standardise." },
      { href: "/assets/imaging", label: "Imaging use", need: "assets.view", about: "Exams per scanner and how busy each is." },
      { href: "/assets/imaging/import", label: "Import exam counts", need: "assets.view", about: "Load exam counts from the RIS or a sheet." },
    ] },
  ] },
  { id: "maintain", name: "Maintain", icon: "maintenance", description: "Fault reports, work orders, planned maintenance, contracts and parts.", sections: [
    { title: "Jobs", pages: [
      { href: "/assets/work-orders", label: "Work orders", need: "assets.view", about: "Fault reports and repair jobs.", menu: true },
      { href: "/assets/my-jobs", label: "My jobs", need: "maintenance.edit", about: "Your own jobs, also on the phone and offline.", menu: true },
      { href: "/assets/work-orders/on-call", label: "On call", need: "workorders.assign", about: "Who is on call for fault reports." },
    ] },
    { title: "Planned work", pages: [
      { href: "/assets/maintenance", label: "Planned maintenance", need: "assets.view", about: "PPM due, overdue and done.", menu: true },
      { href: "/assets/calibration", label: "Calibration", need: "assets.view", about: "Calibration records and certificates.", menu: true },
      { href: "/assets/maintenance/strategy", label: "Risk and strategy", need: "assets.view", about: "Risk score and maintenance type per device." },
      { href: "/assets/equipment-plan", label: "Equipment plan", need: "assets.view", about: "The yearly equipment management plan (GAHAR)." },
      { href: "/assets/critical-backup", label: "Critical backups", need: "assets.view", about: "Spare critical devices each department must keep." },
    ] },
    { title: "Contracts and parts", pages: [
      { href: "/assets/contracts", label: "Service contracts", need: "assets.view", about: "Contracts, response times and penalties.", menu: true },
      { href: "/assets/contracts/holidays", label: "Public holidays", need: "assets.view", about: "Days left out of contract response times." },
      { href: "/assets/parts", label: "Spare parts", need: "assets.view", about: "Parts in stock and parts used on jobs.", menu: true },
    ] },
  ] },
  { id: "safety", name: "Safety & compliance", icon: "shield", description: "Incidents, recalls, safety tests, radiation, imaging QC, training and device security.", sections: [
    { title: "Events", pages: [
      { href: "/assets/incidents", label: "Incidents", need: "assets.view", about: "Device incidents and their review.", menu: true },
      { href: "/assets/incidents/contacts", label: "Incident contacts", need: "assets.view", about: "Who to tell outside the hospital." },
      { href: "/assets/recalls", label: "Recalls", need: "assets.view", about: "Maker recalls and field notices, and affected devices.", menu: true },
      { href: "/assets/recalls/import", label: "Import recalls", need: "assets.view", about: "Load recalls from a sheet." },
    ] },
    { title: "Tests and checks", pages: [
      { href: "/assets/safety-tests", label: "Safety tests", need: "assets.view", about: "Electrical safety tests per device.", menu: true },
      { href: "/assets/radiation", label: "Radiation safety", need: "assets.view", about: "Licences, shielding and staff dose.", menu: true },
      { href: "/assets/imaging-qc", label: "Imaging QC", need: "assets.view", about: "Quality checks on imaging devices.", menu: true },
      { href: "/assets/cryogen", label: "MRI cryogen log", need: "assets.view", about: "Helium level and cold head checks.", menu: true },
      { href: "/assets/security", label: "Device security", need: "assets.view", about: "Networked devices, software and patches." },
    ] },
    { title: "People", pages: [
      { href: "/assets/training", label: "User training", need: "assets.view", about: "Who is trained on which device.", menu: true },
      { href: "/assets/competency", label: "Technician competency", need: "assets.view", about: "What each technician may work on." },
    ] },
  ] },
  { id: "buildings", name: "Buildings & 3D", icon: "buildings", description: "Hospitals, floors and rooms, the floor map, the 3D view, utilities and patient pathways.", sections: [
    { title: "Buildings", pages: [
      { href: "/facilities", label: "Facilities & floors", need: "assets.view", about: "Hospitals, buildings, floors, departments and rooms.", menu: true },
      { href: "/facilities/room-standards", label: "Room standards", need: "assets.view", about: "Size and services each room type needs." },
      { href: "/assets/3d", label: "3D view", need: "assets.view", about: "The hospital in 3D with every device.", menu: true },
      { href: "/assets/map", label: "Floor map", need: "assets.view", about: "Floor plans with devices in their rooms.", menu: true },
    ] },
    { title: "Utilities", pages: [
      { href: "/buildings/utilities", label: "Utilities", need: "assets.view", about: "Medical gas, power and other systems, with tests.", menu: true },
      { href: "/buildings/water", label: "Water quality", need: "assets.view", about: "Water samples and their limits.", menu: true },
    ] },
    { title: "Patient pathways", pages: [
      { href: "/flows", label: "Pathways", need: "assets.view", about: "Routes patients take through the building.", menu: true },
      { href: "/flows/analysis", label: "Pathway analysis", need: "assets.view", about: "Walking distances and crossings." },
      { href: "/flows/simulate", label: "Queue simulation", need: "assets.view", about: "Try patient numbers and staff, see the waits." },
      { href: "/flows/book", label: "Pathway book", need: "assets.view", about: "Every published pathway, one page each, to print." },
    ] },
  ] },
  { id: "reports", name: "Reports", icon: "reports", description: "Standard reports, the executive summary and analytics, to print or export.", sections: [
    { title: "Reports", pages: [
      { href: "/reports", label: "Reports", need: "reports.view", about: "Standard reports to print or export.", menu: true },
      { href: "/reports/executive", label: "Executive summary", need: "prices.view", about: "One page for the director.", menu: true },
      { href: "/reports/data-quality", label: "Data quality", need: "reports.view", about: "Records with missing or odd details.", menu: true },
      { href: "/reports/gahar", label: "GAHAR evidence", need: "reports.view", about: "Evidence for each GAHAR standard.", menu: true },
    ] },
    { title: "Analytics", pages: [
      { href: "/analytics", label: "Analytics", need: "reports.view", about: "Charts across equipment, jobs and money.", menu: true },
      { href: "/analytics/maintenance", label: "Maintenance analytics", need: "reports.view", about: "Uptime, response and repair times." },
      { href: "/analytics/lifecycle", label: "Lifecycle analytics", need: "reports.view", about: "Age and remaining life of the fleet." },
      { href: "/analytics/imaging", label: "Imaging analytics", need: "reports.view", about: "Scanner use and down time." },
      { href: "/analytics/cost", label: "Cost analytics", need: "prices.view", about: "Cost of ownership per device and type." },
      { href: "/analytics/budget", label: "Budget analytics", need: "prices.view", about: "Budget against spending over time." },
      { href: "/analytics/procurement", label: "Procurement analytics", need: "prices.view", about: "Tender times, savings and suppliers." },
      { href: "/analytics/compare", label: "Compare", need: "reports.view", about: "Compare hospitals or departments side by side." },
      { href: "/analytics/export", label: "Export data", need: "reports.view", about: "Download the figures behind the charts." },
    ] },
  ] },
  { id: "setup", name: "Setup", icon: "admin", description: "Users and roles, approval rules, notifications, settings, documents, imports and the audit log.", sections: [
    { title: "People and rules", pages: [
      { href: "/admin/users", label: "Users", need: "users.manage", about: "Accounts, roles and hospitals.", menu: true },
      { href: "/admin/settings", label: "Approval rules & settings", need: "settings.manage", about: "Who approves what, and app settings.", menu: true },
      { href: "/admin/notifications", label: "Notifications and escalation", need: "settings.manage", about: "Defaults per role, waiting times and deputies.", menu: true },
      { href: "/notifications/settings", label: "Email and alert settings", need: "settings.manage", about: "Email delivery and alert timing." },
    ] },
    { title: "Data", pages: [
      { href: "/admin/documents", label: "Documents", need: "settings.manage", about: "All files, with versions and the bin.", menu: true },
      { href: "/admin/imports", label: "Data imports", need: "users.manage", about: "Load data from Excel and see past imports.", menu: true },
      { href: "/admin/backups", label: "Backups", need: "users.manage", about: "Database backups and restore." },
    ] },
    { title: "System", pages: [
      { href: "/admin/audit", label: "Audit log", need: "users.manage", about: "Who changed what, and when.", menu: true },
      { href: "/admin/errors", label: "System errors", need: "settings.manage", about: "Errors the app has recorded." },
      { href: "/admin/api", label: "API tokens", need: "settings.manage", about: "Keys for other systems to read data." },
      { href: "/admin/design", label: "Design parts", need: "settings.manage", about: "Every interface part, for checking the look." },
    ] },
  ] },
];

export const MODULES: AppModule[] = HUBS.map((h) => ({ ...h, links: menuOf(h) }));

/** The hub with this id (Home included), or null. */
export function hubById(id: string): Hub | null {
  return id === HOME.id ? HOME : MODULES.find((m) => m.id === id) ?? null;
}

/** Every page entry of a hub, menu or not. */
export const hubPages = (h: Hub): HubPage[] => h.sections.flatMap((s) => s.pages);

/** A hub's sections with only the pages this person may open (and the assistant only when it is on). */
export function hubSectionsFor(h: Hub, perms: Permission[], assistant = true): HubSection[] {
  const allowed = new Set(perms);
  return h.sections
    .map((s) => ({ ...s, pages: s.pages.filter((p) => (!p.need || allowed.has(p.need)) && (p.flag !== "assistant" || assistant)) }))
    .filter((s) => s.pages.length > 0);
}

/** The hub page URL. */
export const hubHref = (id: string) => `/modules/${id}`;

/** Pages that sit under a hub without being listed in it (detail and new pages). */
const PREFIXES: [string, ModuleId][] = [
  ["/procurement", "buy"], ["/assets", "equipment"], ["/boq", "plan"], ["/facilities", "buildings"], ["/buildings", "buildings"],
  ["/flows", "buildings"], ["/reports", "reports"], ["/analytics", "reports"], ["/admin", "setup"], ["/catalogue", "equipment"],
];

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");
const mostSpecific = (pathname: string, hrefs: string[]) => hrefs.filter((h) => h !== "/" && under(pathname, h)).sort((a, b) => b.length - a.length)[0] ?? null;
const hubIdFromPath = (pathname: string) => /^\/modules\/([a-z]+)$/.exec(pathname)?.[1] ?? null;

/** The menu link a page belongs to: the most specific one, so `/boq` doesn't light up on `/boq/standards`. */
export function activeHref(pathname: string): string | null {
  if (pathname === "/") return "/";
  if (hubIdFromPath(pathname) && hubById(hubIdFromPath(pathname)!)) return pathname;
  return mostSpecific(pathname, [...OVERVIEW, ...MODULES.flatMap((m) => m.links)].map((l) => l.href));
}

/** The hub entry a page belongs to (most specific, menu or not), with its hub. */
function entryOf(pathname: string): { hub: AppModule; page: HubPage } | null {
  const href = mostSpecific(pathname, MODULES.flatMap((m) => hubPages(m).map((p) => p.href)));
  if (!href) return null;
  for (const hub of MODULES) { const page = hubPages(hub).find((p) => p.href === href); if (page) return { hub, page }; }
  return null;
}

/** The hub a page belongs to, or null for the dashboard, the modules page, approvals and account pages. */
export function moduleOf(pathname: string): AppModule | null {
  const id = hubIdFromPath(pathname);
  if (id) return MODULES.find((m) => m.id === id) ?? null;
  const e = entryOf(pathname);
  if (e) return e.hub;
  const pre = PREFIXES.find(([p]) => under(pathname, p))?.[1];
  return MODULES.find((m) => m.id === pre) ?? null;
}

/** The hubs and menu links this user may open; a hub with no menu link left is hidden. */
export function modulesFor(perms: Permission[]): AppModule[] {
  const allowed = new Set(perms);
  return MODULES.map((m) => ({ ...m, links: m.links.filter((l) => !l.need || allowed.has(l.need)) })).filter((m) => m.links.length > 0);
}

/** Every page this user may open, menu or not, with its hub's name: for the Ctrl+K box. */
export function allPagesFor(perms: Permission[], assistant = true): { href: string; label: string; group: string }[] {
  return [HOME, ...modulesFor(perms)].flatMap((h) => hubSectionsFor(h, perms, assistant).flatMap((s) => s.pages.map((p) => ({ href: p.href, label: p.label, group: h.name }))));
}

/** Each role's own hubs first. The rest keep their usual order. */
export const ROLE_ORDER: Record<string, ModuleId[]> = {
  TECHNICIAN: ["maintain", "safety", "equipment", "buildings"],
  BIOMEDICAL: ["maintain", "safety", "equipment", "buildings", "plan"],
  DEPARTMENT_HEAD: ["equipment", "maintain", "plan"],
  PROCUREMENT: ["buy", "pay", "plan"],
  FINANCE: ["pay", "buy", "reports"],
  PLANNER: ["plan", "buildings", "equipment"],
  DIRECTOR: ["reports", "equipment", "buy", "plan"],
};
export function orderModules<T extends { id: string }>(list: T[], role: string | null | undefined): T[] {
  const order: string[] = ROLE_ORDER[role ?? ""] ?? [];
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length + list.findIndex((x) => x.id === id) : i; };
  return [...list].sort((a, b) => rank(a.id) - rank(b.id));
}

/** `Modules › Maintain › Work orders` for the bar above each page; the hub crumb opens the hub page. */
export function pathOf(pathname: string): { label: string; href?: string }[] {
  const m = moduleOf(pathname);
  if (!m) return [];
  const top = { label: "Modules", href: "/modules" };
  if (hubIdFromPath(pathname)) return [top, { label: m.name }];
  const e = entryOf(pathname);
  const page = e && e.hub.id === m.id ? e.page : null;
  return [top, { label: m.name, href: hubHref(m.id) }, ...(page ? [{ label: page.label, href: pathname === page.href ? undefined : page.href }] : [])];
}

/* ── Start page (wave 26): where each person lands after signing in ── */

/** Each role's usual first page. Roles not listed start on the dashboard. */
export const ROLE_HOME: Record<string, string> = {
  TECHNICIAN: "/assets/my-jobs",
  BIOMEDICAL: "/assets/maintenance",
  DEPARTMENT_HEAD: "/assets/department",
  PROCUREMENT: "/procurement",
  FINANCE: "/procurement/invoices",
  PLANNER: "/boq",
  DIRECTOR: "/reports/executive",
};

/** The pages a person may choose as their start page: the dashboard and every hub page they can open (wave 42: menu or not, so a choice made before the regrouping still holds). */
export function startPageOptions(perms: Permission[], role?: string | null): { href: string; label: string; group: string }[] {
  return [
    { href: "/", label: "Dashboard", group: "Overview" },
    ...orderModules(modulesFor(perms), role).flatMap((m) => hubSectionsFor(m, perms).flatMap((s) => s.pages.filter((p) => !p.flag).map((p) => ({ href: p.href, label: p.label, group: m.name })))),
  ];
}

/**
 * Where to land after signing in. A page the person asked for (`next`, other than the bare dashboard) wins; then
 * their own choice; then their role's usual page. Anything they can no longer open falls back to the dashboard.
 */
export function landingPage(next: string | null | undefined, chosen: string | null | undefined, role: string | null | undefined, perms: Permission[]): string {
  if (next && next !== "/" && next.startsWith("/") && !next.startsWith("//")) return next;
  const allowed = new Set(startPageOptions(perms, role).map((o) => o.href));
  if (chosen && allowed.has(chosen)) return chosen;
  const home = ROLE_HOME[role ?? ""];
  return home && allowed.has(home) ? home : "/";
}
