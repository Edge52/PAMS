/** Print layout for reports: hides the app chrome and filters, keeps tables whole and readable on A4 landscape. */
export function ReportPrintStyles() {
  return (
    <style>{`
      .print-only { display: none; }
      @media print {
        #side-nav, button[aria-controls="side-nav"], .no-print,
        main > div:first-child:has(a[href="/notifications"]) { display: none !important; }
        .print-only { display: block !important; }
        html, body { background: #fff !important; }
        main { padding: 0 !important; }
        @page { size: A4 landscape; margin: 12mm 10mm; }
        .report-table, .report-table > table { overflow: visible !important; border: 0 !important; font-size: 11px !important; }
        .report-table th, .report-table td { padding: 3px 6px !important; }
        .report-table thead { display: table-header-group; }
        .report-table tfoot { display: table-row-group; }
        .report-table tr { break-inside: avoid; }
        .report-section { break-inside: auto; }
        a { color: inherit !important; text-decoration: none !important; }
      }
    `}</style>
  );
}
