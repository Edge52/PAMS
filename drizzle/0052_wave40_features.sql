CREATE TYPE "public"."equipment_plan_status" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED');--> statement-breakpoint
ALTER TYPE "public"."approval_entity" ADD VALUE 'EQUIPMENT_PLAN';--> statement-breakpoint
CREATE TABLE "critical_backups" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"department_id" integer NOT NULL,
	"device_type_id" integer NOT NULL,
	"in_use_count" integer DEFAULT 1 NOT NULL,
	"backup_count" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "critical_backups_counts_check" CHECK ("critical_backups"."in_use_count" between 0 and 500 and "critical_backups"."backup_count" between 0 and 500)
);
--> statement-breakpoint
CREATE TABLE "equipment_id_cards" (
	"asset_id" integer PRIMARY KEY NOT NULL,
	"in_house_name" text,
	"in_house_phone" varchar(64),
	"vendor_phone" varchar(64),
	"show_on_label" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_plan_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"kpi_snapshot" jsonb NOT NULL,
	"findings" text,
	"actions" text,
	"reviewed_by_id" integer,
	"reviewed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_plan_reviews_period_check" CHECK ("equipment_plan_reviews"."period_to" >= "equipment_plan_reviews"."period_from")
);
--> statement-breakpoint
CREATE TABLE "equipment_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"year" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"scope" text NOT NULL,
	"risk_method" text NOT NULL,
	"maintenance_strategy" text NOT NULL,
	"kpis" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"status" "equipment_plan_status" DEFAULT 'DRAFT' NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_by_id" integer,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_plans_year_check" CHECK ("equipment_plans"."year" between 2000 and 2100),
	CONSTRAINT "equipment_plans_version_check" CHECK ("equipment_plans"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "asset_quarantines" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"incident_id" integer,
	"reason" text NOT NULL,
	"kept_at" text,
	"placed_by_id" integer,
	"placed_by_name" text,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by_id" integer,
	"released_by_name" text,
	"released_at" timestamp with time zone,
	"release_reason" text
);
--> statement-breakpoint
CREATE TABLE "competencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_type_id" integer NOT NULL,
	"kind" varchar(16) NOT NULL,
	"trained_on" date NOT NULL,
	"expires_on" date,
	"authorised" boolean DEFAULT false NOT NULL,
	"trainer" text,
	"certificate_ref" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"recorded_by_id" integer,
	"recorded_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competencies_dates_check" CHECK ("competencies"."expires_on" is null or "competencies"."expires_on" >= "competencies"."trained_on")
);
--> statement-breakpoint
CREATE TABLE "competency_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer,
	"asset_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"user_id" integer,
	"user_name" text NOT NULL,
	"problem" varchar(16) NOT NULL,
	"reason" text,
	"by_id" integer,
	"by_name" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dosimetry_declarations" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"person_key" text NOT NULL,
	"person_name" text NOT NULL,
	"pregnancy_declared" boolean DEFAULT false NOT NULL,
	"declared_on" date,
	"updated_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dosimetry_extra" (
	"period_id" integer PRIMARY KEY NOT NULL,
	"eye_lens_msv" real,
	"extremity_msv" real,
	CONSTRAINT "dosimetry_extra_check" CHECK (("dosimetry_extra"."eye_lens_msv" is null or "dosimetry_extra"."eye_lens_msv" >= 0) and ("dosimetry_extra"."extremity_msv" is null or "dosimetry_extra"."extremity_msv" >= 0))
);
--> statement-breakpoint
CREATE TABLE "facility_safety_contacts" (
	"facility_id" integer PRIMARY KEY NOT NULL,
	"officer_user_id" integer,
	"officer_name" text,
	"officer_job_title" text,
	"officer_phone" text,
	"officer_email" text,
	"rpo_user_id" integer,
	"updated_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imaging_qc_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"department_id" integer,
	"performed_on" date NOT NULL,
	"items" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"passed" boolean NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"work_order_id" integer,
	"performed_by_id" integer,
	"performed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imaging_qc_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"department_id" integer NOT NULL,
	"month" varchar(7) NOT NULL,
	"reviewer_role" varchar(16) NOT NULL,
	"comments" text,
	"runs" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"missed" integer DEFAULT 0 NOT NULL,
	"signed_by_id" integer,
	"signed_by_name" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "imaging_qc_reviews_month_check" CHECK ("imaging_qc_reviews"."month" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "imaging_qc_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"modality" varchar(12) NOT NULL,
	"name" text NOT NULL,
	"frequency" varchar(8) NOT NULL,
	"items" jsonb NOT NULL,
	"is_example" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_vigilance" (
	"incident_id" integer PRIMARY KEY NOT NULL,
	"maker_reference" text,
	"lot_number" text,
	"udi" text,
	"kept_at" text,
	"reporter_job_title" text,
	"reporter_phone" text,
	"reporter_email" text,
	"updated_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recall_acknowledgements" (
	"id" serial PRIMARY KEY NOT NULL,
	"recall_id" integer NOT NULL,
	"department_id" integer NOT NULL,
	"by_id" integer,
	"by_name" text NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recall_import_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_id" integer NOT NULL,
	"fda_number" text,
	"firm" text,
	"product" text,
	"code_info" text,
	"reason" text,
	"classification" text,
	"initiated_on" date,
	"fda_status" text,
	"matches" jsonb NOT NULL,
	"status" varchar(12) DEFAULT 'PENDING' NOT NULL,
	"recall_id" integer,
	"decided_by_name" text,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recall_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"kind" varchar(16) NOT NULL,
	"rows_read" integer NOT NULL,
	"candidates" integer NOT NULL,
	"by_id" integer,
	"by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_test_insulation" (
	"id" serial PRIMARY KEY NOT NULL,
	"safety_test_id" integer NOT NULL,
	"path" varchar(24) NOT NULL,
	"mohm" real NOT NULL,
	"limit_mohm" real NOT NULL,
	CONSTRAINT "safety_test_insulation_check" CHECK ("safety_test_insulation"."mohm" >= 0)
);
--> statement-breakpoint
CREATE TABLE "safety_test_waivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"context" varchar(12) NOT NULL,
	"work_order_id" integer,
	"reason" text NOT NULL,
	"by_id" integer,
	"by_name" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capital_scenarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb NOT NULL,
	"created_by_id" integer,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "critical_backups" ADD CONSTRAINT "critical_backups_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "critical_backups" ADD CONSTRAINT "critical_backups_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "critical_backups" ADD CONSTRAINT "critical_backups_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_id_cards" ADD CONSTRAINT "equipment_id_cards_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_plan_reviews" ADD CONSTRAINT "equipment_plan_reviews_plan_id_equipment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."equipment_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_plan_reviews" ADD CONSTRAINT "equipment_plan_reviews_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_plans" ADD CONSTRAINT "equipment_plans_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_plans" ADD CONSTRAINT "equipment_plans_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_quarantines" ADD CONSTRAINT "asset_quarantines_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_quarantines" ADD CONSTRAINT "asset_quarantines_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_quarantines" ADD CONSTRAINT "asset_quarantines_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_quarantines" ADD CONSTRAINT "asset_quarantines_placed_by_id_users_id_fk" FOREIGN KEY ("placed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_quarantines" ADD CONSTRAINT "asset_quarantines_released_by_id_users_id_fk" FOREIGN KEY ("released_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competencies" ADD CONSTRAINT "competencies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competencies" ADD CONSTRAINT "competencies_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competencies" ADD CONSTRAINT "competencies_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency_overrides" ADD CONSTRAINT "competency_overrides_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency_overrides" ADD CONSTRAINT "competency_overrides_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency_overrides" ADD CONSTRAINT "competency_overrides_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency_overrides" ADD CONSTRAINT "competency_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency_overrides" ADD CONSTRAINT "competency_overrides_by_id_users_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dosimetry_declarations" ADD CONSTRAINT "dosimetry_declarations_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dosimetry_extra" ADD CONSTRAINT "dosimetry_extra_period_id_dosimetry_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."dosimetry_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_safety_contacts" ADD CONSTRAINT "facility_safety_contacts_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_safety_contacts" ADD CONSTRAINT "facility_safety_contacts_officer_user_id_users_id_fk" FOREIGN KEY ("officer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_safety_contacts" ADD CONSTRAINT "facility_safety_contacts_rpo_user_id_users_id_fk" FOREIGN KEY ("rpo_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_qc_records" ADD CONSTRAINT "imaging_qc_records_template_id_imaging_qc_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."imaging_qc_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_qc_records" ADD CONSTRAINT "imaging_qc_records_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_qc_records" ADD CONSTRAINT "imaging_qc_records_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_qc_records" ADD CONSTRAINT "imaging_qc_records_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_qc_records" ADD CONSTRAINT "imaging_qc_records_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_qc_records" ADD CONSTRAINT "imaging_qc_records_performed_by_id_users_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_qc_reviews" ADD CONSTRAINT "imaging_qc_reviews_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_qc_reviews" ADD CONSTRAINT "imaging_qc_reviews_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_qc_reviews" ADD CONSTRAINT "imaging_qc_reviews_signed_by_id_users_id_fk" FOREIGN KEY ("signed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_qc_templates" ADD CONSTRAINT "imaging_qc_templates_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_vigilance" ADD CONSTRAINT "incident_vigilance_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_acknowledgements" ADD CONSTRAINT "recall_acknowledgements_recall_id_recalls_id_fk" FOREIGN KEY ("recall_id") REFERENCES "public"."recalls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_acknowledgements" ADD CONSTRAINT "recall_acknowledgements_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_acknowledgements" ADD CONSTRAINT "recall_acknowledgements_by_id_users_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_import_rows" ADD CONSTRAINT "recall_import_rows_import_id_recall_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."recall_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_import_rows" ADD CONSTRAINT "recall_import_rows_recall_id_recalls_id_fk" FOREIGN KEY ("recall_id") REFERENCES "public"."recalls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_imports" ADD CONSTRAINT "recall_imports_by_id_users_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_test_insulation" ADD CONSTRAINT "safety_test_insulation_safety_test_id_safety_tests_id_fk" FOREIGN KEY ("safety_test_id") REFERENCES "public"."safety_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_test_waivers" ADD CONSTRAINT "safety_test_waivers_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_test_waivers" ADD CONSTRAINT "safety_test_waivers_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_test_waivers" ADD CONSTRAINT "safety_test_waivers_by_id_users_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_scenarios" ADD CONSTRAINT "capital_scenarios_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_scenarios" ADD CONSTRAINT "capital_scenarios_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "critical_backups_department_type_uq" ON "critical_backups" USING btree ("department_id","device_type_id");--> statement-breakpoint
CREATE INDEX "critical_backups_facility_idx" ON "critical_backups" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "equipment_plan_reviews_plan_idx" ON "equipment_plan_reviews" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_plans_facility_year_version_uq" ON "equipment_plans" USING btree ("facility_id","year","version");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_quarantines_open_idx" ON "asset_quarantines" USING btree ("asset_id") WHERE "asset_quarantines"."released_at" is null;--> statement-breakpoint
CREATE INDEX "asset_quarantines_facility_idx" ON "asset_quarantines" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "competencies_user_idx" ON "competencies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "competencies_type_idx" ON "competencies" USING btree ("device_type_id");--> statement-breakpoint
CREATE INDEX "competency_overrides_facility_idx" ON "competency_overrides" USING btree ("facility_id","at");--> statement-breakpoint
CREATE INDEX "competency_overrides_wo_idx" ON "competency_overrides" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dosimetry_declarations_person_idx" ON "dosimetry_declarations" USING btree ("facility_id","person_key");--> statement-breakpoint
CREATE INDEX "imaging_qc_records_asset_idx" ON "imaging_qc_records" USING btree ("asset_id","performed_on");--> statement-breakpoint
CREATE INDEX "imaging_qc_records_facility_idx" ON "imaging_qc_records" USING btree ("facility_id","performed_on");--> statement-breakpoint
CREATE INDEX "imaging_qc_records_template_idx" ON "imaging_qc_records" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "imaging_qc_reviews_dept_month_idx" ON "imaging_qc_reviews" USING btree ("department_id","month");--> statement-breakpoint
CREATE INDEX "imaging_qc_templates_facility_idx" ON "imaging_qc_templates" USING btree ("facility_id","modality");--> statement-breakpoint
CREATE UNIQUE INDEX "recall_ack_recall_dept_idx" ON "recall_acknowledgements" USING btree ("recall_id","department_id");--> statement-breakpoint
CREATE INDEX "recall_import_rows_import_idx" ON "recall_import_rows" USING btree ("import_id","status");--> statement-breakpoint
CREATE INDEX "safety_test_insulation_test_idx" ON "safety_test_insulation" USING btree ("safety_test_id");--> statement-breakpoint
CREATE INDEX "safety_test_waivers_asset_idx" ON "safety_test_waivers" USING btree ("asset_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "capital_scenarios_facility_name_uq" ON "capital_scenarios" USING btree ("facility_id","name");--> statement-breakpoint
CREATE INDEX "capital_scenarios_facility_idx" ON "capital_scenarios" USING btree ("facility_id");--> statement-breakpoint
-- Read-only BI views (docs/bi-views.sql)
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
LEFT JOIN suppliers s ON s.id = a.supplier_id;--> statement-breakpoint
CREATE OR REPLACE VIEW bi_work_orders AS
SELECT w.id AS work_order_id, w.number, w.asset_id, a.asset_tag, w.facility_id, a.department_id,
       w.type::text AS type, w.priority::text AS priority, w.status::text AS status, w.title, w.device_down,
       w.reported_by_name, w.reported_at, w.due_at, w.assigned_at, w.started_at, w.completed_at, w.closed_at,
       w.downtime_start, w.downtime_end, w.root_cause, w.labor_hours, w.cost, w.currency, w.coverage::text AS coverage
FROM work_orders w JOIN assets a ON a.id = w.asset_id;--> statement-breakpoint
CREATE OR REPLACE VIEW bi_downtime AS
SELECT w.id AS work_order_id, w.asset_id, a.asset_tag, w.facility_id, a.department_id, w.downtime_start, w.downtime_end,
       round((extract(epoch FROM (coalesce(w.downtime_end, now()) - w.downtime_start)) / 3600)::numeric, 2) AS hours_down,
       w.downtime_end IS NULL AS still_down
FROM work_orders w JOIN assets a ON a.id = w.asset_id
WHERE w.downtime_start IS NOT NULL AND w.status <> 'CANCELLED';--> statement-breakpoint
CREATE OR REPLACE VIEW bi_ppm AS
SELECT m.id AS event_id, m.asset_id, a.asset_tag, a.facility_id, a.department_id, m.type::text AS type, m.status::text AS status,
       m.scheduled_date, m.completed_date, m.performed_by, m.vendor_id, m.cost, m.currency, m.downtime_hours,
       (m.status = 'COMPLETED' AND coalesce(m.completed_date, m.scheduled_date) <= m.scheduled_date + 7) AS on_time_7_days
FROM maintenance_events m JOIN assets a ON a.id = m.asset_id
WHERE m.type IN ('PPM', 'CALIBRATION', 'INSPECTION', 'SAFETY_TEST');--> statement-breakpoint
CREATE OR REPLACE VIEW bi_purchase_orders AS
SELECT p.id AS po_id, p.number, p.facility_id, p.project_id, p.supplier_id, s.name AS supplier_name, p.status::text AS status,
       p.issue_date, p.expected_delivery, p.currency, p.budget_line_id, p.framework_id,
       (SELECT sum(l.quantity * l.unit_price) FROM po_lines l WHERE l.po_id = p.id) AS po_value,
       (SELECT sum(l.received_qty * l.unit_price) FROM po_lines l WHERE l.po_id = p.id) AS received_value,
       p.created_at
FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id;--> statement-breakpoint
CREATE OR REPLACE VIEW bi_invoices AS
SELECT i.id AS invoice_id, i.number, i.supplier_invoice_no, i.po_id, p.facility_id, p.budget_line_id, i.supplier_id,
       s.name AS supplier_name, i.invoice_date, i.due_date, i.currency, i.status::text AS status, i.approved_at, i.paid_at,
       (SELECT sum(l.quantity * l.unit_price) FROM invoice_lines l WHERE l.invoice_id = i.id) AS invoice_value, i.delay_penalty
FROM invoices i JOIN purchase_orders p ON p.id = i.po_id JOIN suppliers s ON s.id = i.supplier_id;--> statement-breakpoint
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
CROSS JOIN LATERAL (SELECT coalesce(pr.two_envelope AND pr.financial_opened_at IS NULL, false) AS sealed) x;--> statement-breakpoint
CREATE OR REPLACE VIEW bi_budget_lines AS
SELECT b.id AS budget_line_id, b.facility_id, b.year AS budget_year_start, b.name, b.kind::text AS kind, b.department_id,
       b.project_id, b.amount, b.currency
FROM budget_lines b;--> statement-breakpoint
CREATE OR REPLACE VIEW bi_facilities AS
SELECT f.id AS facility_id, f.code, f.name, f.type::text AS type, f.governorate, f.city, f.total_beds FROM facilities f;--> statement-breakpoint
CREATE OR REPLACE VIEW bi_departments AS
SELECT d.id AS department_id, d.facility_id, d.code, d.name, d.department_type_code, d.beds, d.cost_center FROM departments d;
