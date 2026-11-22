CREATE TYPE "public"."calibration_result" AS ENUM('PASS', 'ADJUSTED', 'FAIL');--> statement-breakpoint
CREATE TYPE "public"."radiation_result" AS ENUM('PASS', 'FAIL');--> statement-breakpoint
CREATE TABLE "tender_addenda" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfq_id" integer NOT NULL,
	"number" integer NOT NULL,
	"issued_on" date NOT NULL,
	"summary" text NOT NULL,
	"extends_deadline" boolean DEFAULT false NOT NULL,
	"previous_closing_date" date,
	"new_closing_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tender_clarifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfq_id" integer NOT NULL,
	"supplier_id" integer,
	"received_on" date NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"sent_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tender_timetable_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"step" varchar(32) NOT NULL,
	"planned_date" date,
	"actual_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_calibration" (
	"asset_id" integer PRIMARY KEY NOT NULL,
	"interval_months" integer NOT NULL,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_calibration_interval_check" CHECK ("asset_calibration"."interval_months" between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "calibrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"calibrated_on" date NOT NULL,
	"performed_by" text NOT NULL,
	"vendor_id" integer,
	"certificate_ref" text,
	"result" "calibration_result" NOT NULL,
	"interval_months" integer,
	"next_due" date,
	"notes" text,
	"status_before" varchar(24),
	"maintenance_event_id" integer,
	"recorded_by_id" integer,
	"recorded_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calibrations_interval_check" CHECK ("calibrations"."interval_months" is null or "calibrations"."interval_months" between 1 and 120),
	CONSTRAINT "calibrations_next_due_check" CHECK ("calibrations"."next_due" is null or "calibrations"."next_due" > "calibrations"."calibrated_on")
);
--> statement-breakpoint
CREATE TABLE "device_type_calibration" (
	"device_type_id" integer PRIMARY KEY NOT NULL,
	"interval_months" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_type_calibration_interval_check" CHECK ("device_type_calibration"."interval_months" between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "dosimetry_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"department_id" integer,
	"person_name" text NOT NULL,
	"person_role" text,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"dose_msv" real NOT NULL,
	"limit_msv" real NOT NULL,
	"flag" varchar(12) DEFAULT 'OK' NOT NULL,
	"notes" text,
	"recorded_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dosimetry_dates_check" CHECK ("dosimetry_periods"."period_start" <= "dosimetry_periods"."period_end"),
	CONSTRAINT "dosimetry_dose_check" CHECK ("dosimetry_periods"."dose_msv" >= 0 and "dosimetry_periods"."limit_msv" > 0)
);
--> statement-breakpoint
CREATE TABLE "protective_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"checked_on" date NOT NULL,
	"method" text,
	"result" "radiation_result" NOT NULL,
	"checked_by" text NOT NULL,
	"next_due" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "protective_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"department_id" integer,
	"room_id" integer,
	"kind" varchar(16) NOT NULL,
	"label" text NOT NULL,
	"interval_months" integer DEFAULT 12 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "protective_items_interval_check" CHECK ("protective_items"."interval_months" between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "radiation_licences" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"room_id" integer,
	"asset_id" integer,
	"licence_number" text NOT NULL,
	"scope" text,
	"issued_on" date,
	"expires_on" date NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radiation_licences_dates_check" CHECK ("radiation_licences"."issued_on" is null or "radiation_licences"."issued_on" <= "radiation_licences"."expires_on")
);
--> statement-breakpoint
CREATE TABLE "radiation_qc_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"asset_id" integer,
	"room_id" integer,
	"test_name" text NOT NULL,
	"tested_on" date NOT NULL,
	"physicist" text NOT NULL,
	"result" "radiation_result" NOT NULL,
	"next_due" date,
	"notes" text,
	"recorded_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radiation_qc_next_due_check" CHECK ("radiation_qc_tests"."next_due" is null or "radiation_qc_tests"."next_due" > "radiation_qc_tests"."tested_on")
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "delay_penalty" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "delay_penalty_note" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "freight_cost" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "insurance_cost" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "duty_pct" real;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "clearance_cost" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "local_delivery_cost" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "procurement_method" varchar(32);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "method_justification" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "approving_authority" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "delay_penalty_rate_pct" real;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "delay_penalty_cap_pct" real;--> statement-breakpoint
ALTER TABLE "tender_addenda" ADD CONSTRAINT "tender_addenda_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_clarifications" ADD CONSTRAINT "tender_clarifications_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_clarifications" ADD CONSTRAINT "tender_clarifications_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_timetable_steps" ADD CONSTRAINT "tender_timetable_steps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_calibration" ADD CONSTRAINT "asset_calibration_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_vendor_id_suppliers_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_type_calibration" ADD CONSTRAINT "device_type_calibration_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dosimetry_periods" ADD CONSTRAINT "dosimetry_periods_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dosimetry_periods" ADD CONSTRAINT "dosimetry_periods_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protective_checks" ADD CONSTRAINT "protective_checks_item_id_protective_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."protective_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protective_items" ADD CONSTRAINT "protective_items_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protective_items" ADD CONSTRAINT "protective_items_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protective_items" ADD CONSTRAINT "protective_items_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiation_licences" ADD CONSTRAINT "radiation_licences_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiation_licences" ADD CONSTRAINT "radiation_licences_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiation_licences" ADD CONSTRAINT "radiation_licences_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiation_qc_tests" ADD CONSTRAINT "radiation_qc_tests_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiation_qc_tests" ADD CONSTRAINT "radiation_qc_tests_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiation_qc_tests" ADD CONSTRAINT "radiation_qc_tests_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tender_addenda_uq" ON "tender_addenda" USING btree ("rfq_id","number");--> statement-breakpoint
CREATE INDEX "tender_clarifications_rfq_idx" ON "tender_clarifications" USING btree ("rfq_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_timetable_steps_uq" ON "tender_timetable_steps" USING btree ("project_id","step");--> statement-breakpoint
CREATE INDEX "calibrations_asset_idx" ON "calibrations" USING btree ("asset_id","calibrated_on");--> statement-breakpoint
CREATE INDEX "calibrations_facility_idx" ON "calibrations" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "dosimetry_facility_idx" ON "dosimetry_periods" USING btree ("facility_id","period_end");--> statement-breakpoint
CREATE INDEX "protective_checks_item_idx" ON "protective_checks" USING btree ("item_id","checked_on");--> statement-breakpoint
CREATE INDEX "protective_items_facility_idx" ON "protective_items" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "protective_items_room_idx" ON "protective_items" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "radiation_licences_facility_idx" ON "radiation_licences" USING btree ("facility_id","expires_on");--> statement-breakpoint
CREATE INDEX "radiation_licences_room_idx" ON "radiation_licences" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "radiation_licences_asset_idx" ON "radiation_licences" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "radiation_qc_facility_idx" ON "radiation_qc_tests" USING btree ("facility_id","tested_on");--> statement-breakpoint
CREATE INDEX "radiation_qc_asset_idx" ON "radiation_qc_tests" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "radiation_qc_room_idx" ON "radiation_qc_tests" USING btree ("room_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_delay_penalty_check" CHECK ("invoices"."delay_penalty" is null or "invoices"."delay_penalty" >= 0);--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_landed_costs_check" CHECK (coalesce("offers"."freight_cost", 0) >= 0 and coalesce("offers"."insurance_cost", 0) >= 0 and coalesce("offers"."clearance_cost", 0) >= 0 and coalesce("offers"."local_delivery_cost", 0) >= 0);--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_duty_pct_check" CHECK ("offers"."duty_pct" is null or ("offers"."duty_pct" >= 0 and "offers"."duty_pct" <= 100));--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_delay_penalty_check" CHECK (("purchase_orders"."delay_penalty_rate_pct" is null or ("purchase_orders"."delay_penalty_rate_pct" >= 0 and "purchase_orders"."delay_penalty_rate_pct" <= 100)) and ("purchase_orders"."delay_penalty_cap_pct" is null or ("purchase_orders"."delay_penalty_cap_pct" >= 0 and "purchase_orders"."delay_penalty_cap_pct" <= 100)));