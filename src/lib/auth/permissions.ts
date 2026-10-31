/**
 * Who may do what. Pure — used by server actions (enforcement), pages (hiding buttons) and the side nav.
 * Approvals are separate: a step is decided by whoever holds its role or is named on it (see lib/approvals),
 * so an admin can't approve a PO just by being an admin.
 */
export const ROLES = ["ADMIN", "DIRECTOR", "PROCUREMENT", "FINANCE", "PLANNER", "BIOMEDICAL", "TECHNICIAN", "DEPARTMENT_HEAD", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  DIRECTOR: "Director (competent authority)",
  PROCUREMENT: "Procurement officer",
  FINANCE: "Finance",
  PLANNER: "BOQ planner",
  BIOMEDICAL: "Biomedical engineer",
  TECHNICIAN: "Technician",
  DEPARTMENT_HEAD: "Department head",
  VIEWER: "Viewer",
};

export const PERMISSIONS = [
  // read
  "boq.view", "procurement.view", "assets.view", "reports.view",
  // planning
  "boq.edit", "boq.approve", "standards.edit",
  // procurement
  "procurement.edit", "specs.edit", "suppliers.edit", "offers.edit", "award.recommend", "po.create", "po.issue", "goods.receive",
  // assets
  "assets.edit", "assets.move", "maintenance.edit", "facilities.edit", "catalogue.edit",
  // work orders (wave 3): anyone signed in can report a fault; assigning and signing off is for the biomedical lead
  "workorders.report", "workorders.assign", "contracts.edit", "parts.edit", "recalls.edit", "assets.dispose",
  // admin
  "users.manage", "settings.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEW: Permission[] = ["boq.view", "procurement.view", "assets.view", "reports.view", "workorders.report"];

const MATRIX: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  DIRECTOR: [...VIEW, "boq.approve"],
  PROCUREMENT: [...VIEW, "procurement.edit", "specs.edit", "suppliers.edit", "offers.edit", "award.recommend", "po.create", "po.issue", "goods.receive", "contracts.edit"],
  FINANCE: [...VIEW],
  PLANNER: [...VIEW, "boq.edit", "standards.edit"],
  BIOMEDICAL: [...VIEW, "boq.edit", "specs.edit", "goods.receive", "assets.edit", "assets.move", "maintenance.edit", "facilities.edit", "catalogue.edit", "workorders.assign", "contracts.edit", "parts.edit", "recalls.edit", "assets.dispose"],
  TECHNICIAN: [...VIEW, "assets.move", "maintenance.edit"],
  DEPARTMENT_HEAD: [...VIEW],
  VIEWER: [...VIEW],
};

const SETS = Object.fromEntries(Object.entries(MATRIX).map(([r, ps]) => [r, new Set(ps)])) as Record<Role, Set<Permission>>;

export function can(role: Role | string | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return SETS[role as Role]?.has(permission) ?? false;
}

export function permissionsOf(role: Role | string): Permission[] {
  return [...(SETS[role as Role] ?? [])];
}

/** Human text for an access error. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "boq.view": "view BOQs", "procurement.view": "view procurement", "assets.view": "view assets", "reports.view": "view reports",
  "boq.edit": "edit BOQs", "boq.approve": "approve BOQs", "standards.edit": "edit BOQ standards",
  "procurement.edit": "edit projects and RFQs", "specs.edit": "edit technical specifications", "suppliers.edit": "edit suppliers",
  "offers.edit": "record and evaluate offers", "award.recommend": "submit award recommendations", "po.create": "create purchase orders",
  "po.issue": "issue purchase orders", "goods.receive": "receive goods",
  "assets.edit": "edit assets", "assets.move": "move assets", "maintenance.edit": "record maintenance",
  "facilities.edit": "edit facilities and rooms", "catalogue.edit": "edit the device catalogue",
  "workorders.report": "report faults", "workorders.assign": "assign and sign off work orders", "contracts.edit": "manage service contracts", "parts.edit": "manage spare parts stock", "recalls.edit": "record and track recalls", "assets.dispose": "propose and record device disposals",
  "users.manage": "manage users", "settings.manage": "change settings",
};
