/** Notes in the 3D model (wave 7, step 7e): the shape the client gets. */
import type { twinNotes } from "@/db/schema";

export type TwinNote = {
  id: number; floorId: number; roomId: number | null; assetId: number | null; x: number; y: number; text: string;
  status: "OPEN" | "DONE"; assigneeId: number | null; assigneeName: string | null; byId: number | null; byName: string | null;
  workOrderId: number | null; at: string; closedByName: string | null;
};

export const noteOf = (n: typeof twinNotes.$inferSelect): TwinNote => ({
  id: n.id, floorId: n.floorId, roomId: n.roomId, assetId: n.assetId, x: n.x, y: n.y, text: n.text, status: n.status,
  assigneeId: n.assigneeId, assigneeName: n.assigneeName, byId: n.createdById, byName: n.createdByName, workOrderId: n.workOrderId,
  at: n.createdAt.toISOString(), closedByName: n.closedByName,
});

