-- Hospital PAMS, wave 40: read-only views for BI tools (Power BI, Excel, Metabase…).
-- The lead copies this into the wave 40 migration. Safe to run again (CREATE OR REPLACE).
-- Rules: no passwords, two-step secrets, tokens, e-mail addresses, phone numbers or free-text notes; people only by
-- name. Prices ARE included (purchase cost, PO and invoice values, offer totals): anyone with BI access sees prices.
-- Offer prices of a two-envelope tender stay NULL until its financial envelopes are opened (as in the app).
-- The read-only role pams_bi and the Power BI connection: docs/deploy.md, "Read-only access for BI tools".

CREATE OR REPLACE VIEW bi_assets AS
SELECT a.id AS asset_id, a.asset_tag, a.facility_id, f.code AS facility_code, f.name AS facility_name,
       a.department_id, d.name AS department_name, dt.code AS device_type_code, dt.name AS device_type_name,
       a.manufacturer, a.model, a.serial_number, a.status::text AS status, a.condition::text AS condition,
       a.criticality::text AS criticality, a.supplier_id, s.name AS supplier_name,
       a.purchase_cost, a.currency, a.purchase_date, a.install_date, a.warranty_end,
       coalesce(a.life_expectancy_years, dt.life_expectancy_years) AS life_expectancy_years, a.created_at
FROM assets a
JOIN device_types dt ON dt.id = a.device_type_id
JOIN facilities f ON f.id = a.facility_id
LEFT JOIN departments d ON d.id = a.department_id
LEFT JOIN suppliers s ON s.id = a.supplier_id;

CREATE OR REPLACE VIEW bi_work_orders AS
SELECT w.id AS work_order_id, w.number, w.asset_id, a.asset_tag, w.facility_id, a.department_id,
       w.type::text AS type, w.priority::text AS priority, w.status::text AS status, w.title, w.device_down,
       w.reported_by_name, w.reported_at, w.due_at, w.assigned_at, w.started_at, w.completed_at, w.closed_at,
       w.downtime_start, w.downtime_end, w.root_cause, w.labor_hours, w.cost, w.currency, w.coverage::text AS coverage
FROM work_orders w JOIN assets a ON a.id = w.asset_id;

-- One row per job with downtime, hours down up to now for jobs still open.
CREATE OR REPLACE VIEW bi_downtime AS
SELECT w.id AS work_order_id, w.asset_id, a.asset_tag, w.facility_id, a.department_id, w.downtime_start, w.downtime_end,
       round((extract(epoch FROM (coalesce(w.downtime_end, now()) - w.downtime_start)) / 3600)::numeric, 2) AS hours_down,
       w.downtime_end IS NULL AS still_down
FROM work_orders w JOIN assets a ON a.id = w.asset_id
WHERE w.downtime_start IS NOT NULL AND w.status <> 'CANCELLED';

CREATE OR REPLACE VIEW bi_ppm AS
SELECT m.id AS event_id, m.asset_id, a.asset_tag, a.facility_id, a.department_id, m.type::text AS type, m.status::text AS status,
       m.scheduled_date, m.completed_date, m.performed_by, m.vendor_id, m.cost, m.currency, m.downtime_hours,
       (m.status = 'COMPLETED' AND coalesce(m.completed_date, m.scheduled_date) <= m.scheduled_date + 7) AS on_time_7_days
FROM maintenance_events m JOIN assets a ON a.id = m.asset_id
WHERE m.type IN ('PPM', 'CALIBRATION', 'INSPECTION', 'SAFETY_TEST');

CREATE OR REPLACE VIEW bi_purchase_orders AS
SELECT p.id AS po_id, p.number, p.facility_id, p.project_id, p.supplier_id, s.name AS supplier_name, p.status::text AS status,
       p.issue_date, p.expected_delivery, p.currency, p.budget_line_id, p.framework_id,
       (SELECT sum(l.quantity * l.unit_price) FROM po_lines l WHERE l.po_id = p.id) AS po_value,
       (SELECT sum(l.received_qty * l.unit_price) FROM po_lines l WHERE l.po_id = p.id) AS received_value,
       p.created_at
FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id;

CREATE OR REPLACE VIEW bi_invoices AS
SELECT i.id AS invoice_id, i.number, i.supplier_invoice_no, i.po_id, p.facility_id, p.budget_line_id, i.supplier_id,
       s.name AS supplier_name, i.invoice_date, i.due_date, i.currency, i.status::text AS status, i.approved_at, i.paid_at,
       (SELECT sum(l.quantity * l.unit_price) FROM invoice_lines l WHERE l.invoice_id = i.id) AS invoice_value, i.delay_penalty
FROM invoices i JOIN purchase_orders p ON p.id = i.po_id JOIN suppliers s ON s.id = i.supplier_id;

CREATE OR REPLACE VIEW bi_offers AS
SELECT o.id AS offer_id, o.project_id, pr.code AS project_code, pr.facility_id, o.rfq_id, o.supplier_id, s.name AS supplier_name,
       o.offer_date, o.valid_until, o.currency, o.delivery_weeks, o.warranty_months, o.status::text AS status, o.technical_score,
       CASE WHEN sealed THEN NULL ELSE o.financial_score END AS financial_score,
       CASE WHEN sealed THEN NULL ELSE (SELECT sum(l.quantity * l.unit_price * (1 - coalesce(l.discount_pct, 0) / 100.0))
         FROM offer_lines l WHERE l.offer_id = o.id AND NOT l.is_optional) END AS offer_value,
       sealed AS prices_sealed
FROM offers o
JOIN suppliers s ON s.id = o.supplier_id
LEFT JOIN projects pr ON pr.id = o.project_id
CROSS JOIN LATERAL (SELECT coalesce(pr.two_envelope AND pr.financial_opened_at IS NULL, false) AS sealed) x;

CREATE OR REPLACE VIEW bi_budget_lines AS
SELECT b.id AS budget_line_id, b.facility_id, b.year AS budget_year_start, b.name, b.kind::text AS kind, b.department_id,
       b.project_id, b.amount, b.currency
FROM budget_lines b;

CREATE OR REPLACE VIEW bi_facilities AS
SELECT f.id AS facility_id, f.code, f.name, f.type::text AS type, f.governorate, f.city, f.total_beds FROM facilities f;

CREATE OR REPLACE VIEW bi_departments AS
SELECT d.id AS department_id, d.facility_id, d.code, d.name, d.department_type_code, d.beds, d.cost_center FROM departments d;
