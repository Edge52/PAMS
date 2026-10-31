/** Disposal vocabulary. Pure — shared by forms, pages and actions. */
export const DISPOSAL_REASONS = ["BEYOND_REPAIR", "END_OF_LIFE", "OBSOLETE", "UNSAFE", "RECALLED", "LOST_OR_STOLEN", "OTHER"] as const;
export const DISPOSAL_METHODS = ["SCRAP", "SALE", "DONATION", "RETURN_TO_SUPPLIER", "TRADE_IN", "OTHER"] as const;

export const REASON_LABELS: Record<(typeof DISPOSAL_REASONS)[number], string> = {
  BEYOND_REPAIR: "Beyond economic repair",
  END_OF_LIFE: "End of service life",
  OBSOLETE: "Obsolete: no parts or support",
  UNSAFE: "Unsafe to use",
  RECALLED: "Recalled by the manufacturer",
  LOST_OR_STOLEN: "Lost or stolen",
  OTHER: "Other",
};
export const METHOD_LABELS: Record<(typeof DISPOSAL_METHODS)[number], string> = {
  SCRAP: "Scrap / recycle (e-waste)",
  SALE: "Sell",
  DONATION: "Donate",
  RETURN_TO_SUPPLIER: "Return to supplier",
  TRADE_IN: "Trade in against a new device",
  OTHER: "Other",
};
