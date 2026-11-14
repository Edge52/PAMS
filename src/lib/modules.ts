/**
 * The app's modules (wave 21): each page belongs to one module, the side menu shows one module at a time, and
 * `/modules` lists them all. Pure data and helpers, so the menu, the modules page and the command palette agree.
 */
import type { Permission } from "@/lib/auth/permissions";

export type NavLink = { href: string; label: string; need?: Permission; flag?: "assistant" };
export type ModuleId = "planning" | "procurement" | "finance" | "assets" | "maintenance" | "buildings" | "pathways" | "reports" | "admin";
export type AppModule = { id: ModuleId; name: string; description: string; links: NavLink[] };

/** Links shown above every module's own menu. */
export const OVERVIEW: NavLink[] = [
  { href: "/", label: "Dashboard" },
  { href: "/modules", label: "All modules" },
  { href: "/approvals", label: "Approvals" },
  { href: "/assistant", label: "Assistant", flag: "assistant" },
];

export const MODULES: AppModule[] = [
  { id: "planning", name: "Planning", description: "Equipment lists from beds and rooms, the capital plan and opening a new wing.", links: [
    { href: "/boq", label: "BOQs", need: "boq.view" },
    { href: "/boq/standards", label: "Standards & ratios", need: "boq.view" },
    { href: "/boq/room-kits", label: "Room kits", need: "boq.view" },
    { href: "/assets/capital-plan", label: "Capital plan", need: "assets.view" },
    { href: "/assets/replacement", label: "Replacement plan", need: "assets.view" },
    { href: "/assets/commissioning", label: "Commissioning", need: "assets.view" },
  ] },
  { id: "procurement", name: "Procurement", description: "Tenders under Law 182/2018, from specifications to award and purchase order.", links: [
    { href: "/procurement", label: "Projects & tenders", need: "procurement.view" },
    { href: "/procurement/rfqs", label: "RFQs", need: "procurement.view" },
    { href: "/procurement/offers", label: "Offers", need: "procurement.view" },
    { href: "/procurement/purchase-orders", label: "Purchase orders", need: "procurement.view" },
    { href: "/procurement/suppliers", label: "Suppliers", need: "procurement.view" },
  ] },
  { id: "finance", name: "Finance", description: "Budgets, invoices with three-way match and framework agreements.", links: [
    { href: "/procurement/budgets", label: "Budgets", need: "procurement.view" },
    { href: "/procurement/invoices", label: "Invoices", need: "procurement.view" },
    { href: "/procurement/frameworks", label: "Framework agreements", need: "procurement.view" },
  ] },
  { id: "assets", name: "Assets", description: "The equipment register, labels, requests, rounds and disposals.", links: [
    { href: "/assets", label: "Asset register", need: "assets.view" },
    { href: "/assets/department", label: "My department", need: "assets.view" },
    { href: "/assets/requests", label: "Equipment requests", need: "assets.view" },
    { href: "/assets/rounds", label: "Rounds and stock-take", need: "assets.view" },
    { href: "/assets/fleet", label: "Fleet & standardisation", need: "assets.view" },
    { href: "/assets/imaging", label: "Imaging use", need: "assets.view" },
    { href: "/assets/disposals", label: "Disposals", need: "assets.view" },
    { href: "/catalogue", label: "Device catalogue", need: "assets.view" },
  ] },
  { id: "maintenance", name: "Maintenance", description: "Fault reports, planned maintenance, contracts, spare parts and recalls.", links: [
    { href: "/assets/work-orders", label: "Work orders", need: "assets.view" },
    { href: "/assets/maintenance", label: "Planned maintenance", need: "assets.view" },
    { href: "/assets/contracts", label: "Service contracts", need: "assets.view" },
    { href: "/assets/parts", label: "Spare parts", need: "assets.view" },
    { href: "/assets/recalls", label: "Recalls", need: "assets.view" },
  ] },
  { id: "buildings", name: "Buildings & 3D", description: "Hospitals, floors and rooms, the floor map and the 3D view.", links: [
    { href: "/facilities", label: "Facilities & floors", need: "assets.view" },
    { href: "/assets/3d", label: "3D view", need: "assets.view" },
    { href: "/assets/map", label: "Floor map", need: "assets.view" },
    { href: "/facilities/room-standards", label: "Room standards", need: "assets.view" },
  ] },
  { id: "pathways", name: "Patient pathways", description: "Routes through the building, walking distances and queue simulation.", links: [
    { href: "/flows", label: "Pathways", need: "assets.view" },
    { href: "/flows/analysis", label: "Analysis", need: "assets.view" },
    { href: "/flows/simulate", label: "Simulation", need: "assets.view" },
  ] },
  { id: "reports", name: "Reports", description: "Standard reports and the executive summary, to print or export.", links: [
    { href: "/reports", label: "Reports", need: "reports.view" },
    { href: "/reports/executive", label: "Executive summary", need: "reports.view" },
  ] },
  { id: "admin", name: "Administration", description: "Users and roles, approval rules, settings, the audit log and backups.", links: [
    { href: "/admin/users", label: "Users", need: "users.manage" },
    { href: "/admin/settings", label: "Approval rules & settings", need: "settings.manage" },
    { href: "/admin/audit", label: "Audit log", need: "users.manage" },
    { href: "/admin/backups", label: "Backups", need: "users.manage" },
    { href: "/admin/design", label: "Design parts", need: "settings.manage" },
  ] },
];

/** Pages that sit under a module without being in its menu. */
const PREFIXES: [string, ModuleId][] = [
  ["/procurement", "procurement"], ["/assets", "assets"], ["/boq", "planning"], ["/facilities", "buildings"],
  ["/flows", "pathways"], ["/reports", "reports"], ["/admin", "admin"], ["/catalogue", "assets"],
];

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

/** The menu link a page belongs to: the most specific one, so `/boq` doesn't light up on `/boq/standards`. */
export function activeHref(pathname: string): string | null {
  if (pathname === "/") return "/";
  const all = [...OVERVIEW, ...MODULES.flatMap((m) => m.links)].map((l) => l.href).filter((h) => h !== "/");
  return all.filter((h) => under(pathname, h)).sort((a, b) => b.length - a.length)[0] ?? null;
}

/** The module a page belongs to, or null for the dashboard, the modules page, approvals and account pages. */
export function moduleOf(pathname: string): AppModule | null {
  const href = activeHref(pathname);
  const byLink = href ? MODULES.find((m) => m.links.some((l) => l.href === href)) : null;
  if (byLink) return byLink;
  const id = PREFIXES.find(([p]) => under(pathname, p))?.[1];
  return MODULES.find((m) => m.id === id) ?? null;
}

/** The modules and links this user may open; a module with no link left is hidden. */
export function modulesFor(perms: Permission[]): AppModule[] {
  const allowed = new Set(perms);
  return MODULES.map((m) => ({ ...m, links: m.links.filter((l) => !l.need || allowed.has(l.need)) })).filter((m) => m.links.length > 0);
}

/** Each role's own modules first (wave 19's menu order, by module). The rest keep their usual order. */
export const ROLE_ORDER: Record<string, ModuleId[]> = {
  TECHNICIAN: ["maintenance", "assets", "buildings"],
  BIOMEDICAL: ["maintenance", "assets", "buildings", "planning"],
  DEPARTMENT_HEAD: ["assets", "maintenance", "planning"],
  PROCUREMENT: ["procurement", "finance", "planning"],
  FINANCE: ["finance", "procurement", "reports"],
  PLANNER: ["planning", "buildings", "pathways", "assets"],
  DIRECTOR: ["reports", "assets", "procurement", "planning"],
};
export function orderModules<T extends { id: string }>(list: T[], role: string | null | undefined): T[] {
  const order: string[] = ROLE_ORDER[role ?? ""] ?? [];
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length + list.findIndex((x) => x.id === id) : i; };
  return [...list].sort((a, b) => rank(a.id) - rank(b.id));
}

/** `Modules › Maintenance › Work orders` for the bar above each page. */
export function pathOf(pathname: string): { label: string; href?: string }[] {
  const m = moduleOf(pathname);
  if (!m) return [];
  const href = activeHref(pathname);
  const link = m.links.find((l) => l.href === href);
  return [{ label: "Modules", href: "/modules" }, { label: m.name, href: m.links[0]?.href }, ...(link ? [{ label: link.label, href: pathname === link.href ? undefined : link.href }] : [])];
}
