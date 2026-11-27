/** What an import's preview and commit actions return to the import wizard (wave 41). */
export type ImportState = {
  error?: string;
  fileName?: string;
  rows?: { rowNumber: number; values: Record<string, string | number | null>; errors: string[]; warnings?: string[] }[];
  validCount?: number;
  errorCount?: number;
  unknownHeaders?: string[];
  /** The checked rows, sent back on commit and checked again there. */
  payload?: string;
  done?: string;
  doneHref?: string;
  doneLabel?: string;
} | null;
