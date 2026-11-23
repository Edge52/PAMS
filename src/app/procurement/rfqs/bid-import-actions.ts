"use server";
/**
 * "Import a bid from Excel" on an RFQ (wave 38). One action for both buttons of the form: "Check the file" reads and
 * validates it (nothing saved) and returns a preview; "Import bid" reads the same file again, validates it again and
 * saves a Received offer. Entering a bid is data entry, so it is allowed on a sealed two-envelope tender; prices are
 * shown back only to people with prices.view and only once the financial envelopes are open.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { seesPrices } from "@/lib/auth/prices";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { readBidFile, validateBid } from "@/lib/procurement/bid-import";
import { bidContext, importTarget, saveImportedBid } from "@/lib/procurement/bid-import-server";
import { bidPreview, type BidImportState } from "@/lib/procurement/bid-import-view";
import { pricesSealed } from "@/lib/procurement/sealed";

const MAX_BYTES = 5 * 1024 * 1024;

const schema = z.object({
  rfqId: z.coerce.number({ error: "The RFQ is missing. Reload the page." }).int().positive(),
  supplierId: z.coerce.number({ error: "Choose the invited supplier whose bid this is." }).int().positive("Choose the invited supplier whose bid this is."),
  intent: z.enum(["check", "import"]).default("check"),
});

export async function bidImportAction(_prev: BidImportState, fd: FormData): Promise<BidImportState> {
  const me = await requirePermission("offers.edit");
  const p = schema.safeParse({ rfqId: fd.get("rfqId"), supplierId: fd.get("supplierId") || undefined, intent: fd.get("intent") || undefined });
  if (!p.success) return { errors: [...new Set(p.error.issues.map((i) => i.message))] };
  const { rfqId, supplierId, intent } = p.data;
  const c = await bidContext(rfqId);
  if (!c) return { errors: ["This RFQ no longer exists."] };
  await requireFacilityAccess(c.project.facilityId, me);
  if (c.rfq.status === "CANCELLED") return { errors: ["This RFQ is cancelled."] };
  const supplier = c.invited.find((s) => s.id === supplierId);
  if (!supplier) return { errors: ["Choose a supplier invited to this RFQ. Invite them first if needed."] };
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { errors: ["Choose the filled bid template (.xlsx)."] };
  if (file.size > MAX_BYTES) return { errors: ["The file is larger than 5 MB. Use the bid template from this RFQ."] };
  if (!/\.xlsx$/i.test(file.name)) return { errors: ["Choose an Excel file (.xlsx). Older .xls files must be saved as .xlsx first."] };

  const check = validateBid(await readBidFile(await file.arrayBuffer()), { rfqId, supplierId, lines: c.lines });
  const target = await importTarget(rfqId, supplierId);
  if (target.blocked) check.errors.push({ where: "Offer", message: target.blocked });
  const preview = bidPreview(check, {
    supplier: supplier.name, lines: c.lines, showPrices: seesPrices(me.role), sealed: pricesSealed(c.project),
    replaces: target.offer ? `${target.offer.reference} (its lines and compliance answers will be replaced)` : null,
  });
  if (intent === "check" || check.errors.length) {
    return check.errors.length
      ? { errors: [`${check.errors.length} problem${check.errors.length === 1 ? "" : "s"} to fix in the file. Nothing was saved.`], preview }
      : { message: `The file is ready to import: ${check.lines.length} item${check.lines.length === 1 ? "" : "s"} priced. Nothing saved yet.`, preview };
  }
  const saved = await saveImportedBid(c, supplier, check, file.name, me.name);
  if ("error" in saved) return { errors: [saved.error!], preview };
  revalidatePath(`/procurement/rfqs/${rfqId}`);
  revalidatePath(`/procurement/${c.project.id}`);
  revalidatePath(`/procurement/offers/${saved.offerId}`);
  revalidatePath("/procurement/offers");
  return {
    imported: true, preview,
    message: `${saved.created ? "Offer created" : "Offer updated"} from the file: ${check.header!.reference} from ${supplier.name}, ${check.lines.length} line${check.lines.length === 1 ? "" : "s"}. Check it on the offer's page before the evaluation.`,
  };
}
