/** Report shapes shared by the pages, the Excel export and the tests. Pure. */

export type Cell = string | number | null;
export type Row = Record<string, Cell>;

/**
 * text  plain text           int    whole number         money  amount in the row's own currency (currencyKey)
 * egp   amount in EGP        date   YYYY-MM-DD           pct    0–100 percentage      days   whole days
 */
export type CellType = "text" | "int" | "money" | "egp" | "date" | "pct" | "days";

export type Column = {
  key: string;
  header: string;
  type?: CellType;
  /** Excel column width in characters. */
  width?: number;
  /** money: the row key holding the ISO currency code. */
  currencyKey?: string;
  /** Second line under the value in the on-screen table (not exported). */
  subKey?: string;
  /** Link for the on-screen table. */
  href?: (row: Row) => string | null;
  /** Monospace (asset tags, document numbers). */
  mono?: boolean;
  /** On-screen colour for a value (late, overdue, low compliance). */
  tone?: (row: Row) => "danger" | "warn" | "ok" | null;
  /** Show the column only on screen or only in the Excel file (default both). */
  only?: "screen" | "excel";
};

export type Section = {
  key: string;
  title?: string;
  columns: Column[];
  rows: Row[];
  /** Totals row keyed like the columns; the first column usually holds a label. */
  totals?: Row;
  empty: string;
};

export type ReportResult = {
  sections: Section[];
  /** Short facts above the table ("12 projects", "EGP 4.2M open"). */
  summary?: { label: string; value: string }[];
  /** Footnotes, e.g. how compliance is counted, missing exchange rates. */
  notes?: string[];
};

export type FilterKind = "facility" | "dateRange" | "days" | "grace" | "projectStatus";

export type ReportFilters = {
  facilityId: number | null;
  from: string | null;
  to: string | null;
  days: number;
  grace: number;
  projectStatus: "open" | "all";
};

export type ReportContext = {
  filters: ReportFilters;
  /** Facilities the user may see: null = all. */
  scope: number[] | null;
  today: string;
};
