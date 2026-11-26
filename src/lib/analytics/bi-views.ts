/** The read-only BI views (wave 40). SQL in docs/bi-views.sql; role and Power BI steps in docs/deploy.md. Pure. */
export const BI_VIEWS: { name: string; about: string }[] = [
  { name: "bi_assets", about: "Devices: hospital, department, type, maker and model, status, purchase cost and dates." },
  { name: "bi_work_orders", about: "Work orders: device, type, priority, status, the times of each step, cost." },
  { name: "bi_downtime", about: "Jobs with downtime: start, end and hours down." },
  { name: "bi_ppm", about: "Planned maintenance, calibration and safety tests: scheduled and done dates, on time (7 days' grace)." },
  { name: "bi_purchase_orders", about: "Purchase orders: supplier, status, dates, value and value received." },
  { name: "bi_invoices", about: "Supplier invoices: order, status, dates and value." },
  { name: "bi_offers", about: "Offers: supplier, scores and value (empty while a two-envelope tender is still sealed)." },
  { name: "bi_budget_lines", about: "Budget lines: hospital, budget year, kind and amount." },
  { name: "bi_facilities", about: "Hospitals and their beds." },
  { name: "bi_departments", about: "Departments and their beds." },
];
