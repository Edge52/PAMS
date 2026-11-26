import "server-only";
/**
 * Who may see and change attachments. Kept out of the "use server" documents module on purpose: every export of a
 * "use server" file becomes a callable endpoint, and these are internal helpers.
 */
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { assets, boqs, calibrations, radiationLicences, frameworks, disposals, facilities, twinNotes, serviceContracts, workOrders, deliveries, documents, offers, projects, purchaseOrders, rfqs, techSpecs, trainingSessions, documentVersions, users, competencies } from "@/db/schema";
import { can, type Permission } from "./auth/permissions";
import { facilityScope, getCurrentUser, requireFacilityAccess, requirePermission, type CurrentUser } from "./auth/session";

export const ENTITY_TYPES = ["offer", "po", "asset", "spec", "supplier", "project", "delivery", "boq", "rfq", "work_order", "contract", "disposal", "twin_note", "facility", "framework", "training", "calibration", "radiation_licence", "competency"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

/** Which module's read permission covers each kind of record's attachments. */
export const VIEW_PERMISSION: Record<EntityType, Permission> = {
  offer: "procurement.view", po: "procurement.view", asset: "assets.view", spec: "procurement.view", supplier: "procurement.view",
  project: "procurement.view", delivery: "procurement.view", boq: "boq.view", rfq: "procurement.view", work_order: "assets.view", contract: "assets.view", disposal: "assets.view",
  twin_note: "assets.view", facility: "assets.view", framework: "procurement.view", training: "assets.view",
  calibration: "assets.view", radiation_licence: "assets.view", competency: "assets.view",
};

/** Who may attach to / remove from each kind of record. */
export const EDIT_PERMISSION: Record<EntityType, Permission> = {
  offer: "offers.edit", po: "po.create", asset: "assets.edit", spec: "specs.edit", supplier: "suppliers.edit",
  project: "procurement.edit", delivery: "goods.receive", boq: "boq.edit", rfq: "procurement.edit", work_order: "maintenance.edit", contract: "contracts.edit", disposal: "assets.dispose",
  // Notes (wave 8): anyone who can add notes may add photos. Hospital documents (saved renders): facility editors.
  twin_note: "assets.view", facility: "facilities.edit", framework: "procurement.edit",
  // User training (wave 27): the sign-in sheet, added by whoever records training.
  training: "maintenance.edit",
  // Wave 37: the calibration certificate and the ENRRA licence, added by whoever records them.
  calibration: "maintenance.edit", radiation_licence: "maintenance.edit",
  // Wave 40: a technician's training certificate, added by the biomedical lead who records it (no hospital).
  competency: "workorders.assign",
};

/** The facility a record belongs to (null = none, visible to all), or undefined when the record doesn't exist. */
export async function facilityOfEntity(entityType: string, id: number): Promise<number | null | undefined> {
  const one = async (q: Promise<{ f: number | null }[]>) => { const r = await q; return r.length ? r[0].f : undefined; };
  switch (entityType) {
    case "asset": return one(db.select({ f: assets.facilityId }).from(assets).where(eq(assets.id, id)));
    case "po": return one(db.select({ f: purchaseOrders.facilityId }).from(purchaseOrders).where(eq(purchaseOrders.id, id)));
    case "project": return one(db.select({ f: projects.facilityId }).from(projects).where(eq(projects.id, id)));
    case "boq": return one(db.select({ f: boqs.facilityId }).from(boqs).where(eq(boqs.id, id)));
    case "offer": return one(db.select({ f: projects.facilityId }).from(offers).innerJoin(projects, eq(projects.id, offers.projectId)).where(eq(offers.id, id)));
    case "rfq": return one(db.select({ f: projects.facilityId }).from(rfqs).innerJoin(projects, eq(projects.id, rfqs.projectId)).where(eq(rfqs.id, id)));
    case "spec": return one(db.select({ f: projects.facilityId }).from(techSpecs).leftJoin(projects, eq(projects.id, techSpecs.projectId)).where(eq(techSpecs.id, id)));
    case "disposal": return one(db.select({ f: disposals.facilityId }).from(disposals).where(eq(disposals.id, id)));
    case "contract": return one(db.select({ f: serviceContracts.facilityId }).from(serviceContracts).where(eq(serviceContracts.id, id)));
    case "work_order": return one(db.select({ f: workOrders.facilityId }).from(workOrders).where(eq(workOrders.id, id)));
    case "twin_note": return one(db.select({ f: twinNotes.facilityId }).from(twinNotes).where(eq(twinNotes.id, id)));
    case "facility": return one(db.select({ f: facilities.id }).from(facilities).where(eq(facilities.id, id)));
    case "training": return one(db.select({ f: trainingSessions.facilityId }).from(trainingSessions).where(eq(trainingSessions.id, id)));
    case "calibration": return one(db.select({ f: calibrations.facilityId }).from(calibrations).where(eq(calibrations.id, id)));
    case "radiation_licence": return one(db.select({ f: radiationLicences.facilityId }).from(radiationLicences).where(eq(radiationLicences.id, id)));
    case "framework": return one(db.select({ f: frameworks.facilityId }).from(frameworks).where(eq(frameworks.id, id)));
    case "delivery": return one(db.select({ f: purchaseOrders.facilityId }).from(deliveries).innerJoin(purchaseOrders, eq(purchaseOrders.id, deliveries.poId)).where(eq(deliveries.id, id)));
    case "competency": { const r = await db.select({ id: competencies.id }).from(competencies).where(eq(competencies.id, id)); return r.length ? null : undefined; }
    default: return null; // suppliers have no facility
  }
}

/**
 * Permission + facility check for changing a record's attachments. Redirects when not allowed; null when the record
 * doesn't exist. Returns the signed-in user.
 */
export async function requireDocumentEdit(entityType: string, entityId: number): Promise<CurrentUser | null> {
  const perm = EDIT_PERMISSION[entityType as EntityType];
  if (!perm) return null;
  const me = await requirePermission(perm);
  const facilityId = await facilityOfEntity(entityType, entityId);
  if (facilityId === undefined) return null;
  await requireFacilityAccess(facilityId, me);
  return me;
}

/** Whether the signed-in user may add/remove attachments on this kind of record (for hiding the controls). */
export async function canEditDocuments(entityType: string): Promise<boolean> {
  const me = await getCurrentUser();
  const perm = EDIT_PERMISSION[entityType as EntityType];
  return !!me && !!perm && can(me.role, perm);
}


/** May this user see the attachments of this record (role + facility)? */
export async function canViewDocumentsOf(me: CurrentUser, entityType: string, entityId: number): Promise<boolean> {
  const perm = VIEW_PERMISSION[entityType as EntityType];
  if (!perm || !can(me.role, perm)) return false;
  const facilityId = await facilityOfEntity(entityType, entityId);
  if (facilityId === undefined) return false;
  if (facilityId === null) return true;
  const scope = await facilityScope(me);
  return scope === null || scope.includes(facilityId);
}

/** Attachments of a record (removed ones left out). Callers are pages that already checked access to the record itself. */
export async function listDocuments(entityType: string, entityId: number) {
  const rows = await db.select({ d: documents, by: users.name }).from(documents).leftJoin(users, eq(users.id, documents.uploadedById))
    .where(and(eq(documents.entityType, entityType), eq(documents.entityId, entityId), isNull(documents.deletedAt)))
    .orderBy(desc(documents.uploadedAt));
  return rows.map((r) => ({ ...r.d, uploadedByName: r.by }));
}

/** Earlier files of these documents (wave 39), newest first, with who uploaded each. */
export async function listVersions(documentIds: number[]) {
  if (!documentIds.length) return [];
  const rows = await db.select({ v: documentVersions, by: users.name }).from(documentVersions).leftJoin(users, eq(users.id, documentVersions.uploadedById))
    .where(inArray(documentVersions.documentId, documentIds)).orderBy(desc(documentVersions.version));
  return rows.map((r) => ({ ...r.v, uploadedByName: r.by }));
}

const remover = alias(users, "remover");

/** Removed documents for the administrators' "Deleted documents" page, newest removal first. */
export async function listDeletedDocuments(limit = 500) {
  const rows = await db.select({ d: documents, by: remover.name }).from(documents).leftJoin(remover, eq(remover.id, documents.deletedById))
    .where(isNotNull(documents.deletedAt)).orderBy(desc(documents.deletedAt)).limit(limit);
  return rows.map((r) => ({ ...r.d, deletedByName: r.by }));
}
