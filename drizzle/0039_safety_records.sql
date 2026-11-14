CREATE TYPE "public"."applied_part" AS ENUM('NONE', 'B', 'BF', 'CF');--> statement-breakpoint
CREATE TYPE "public"."incident_harm" AS ENUM('NONE', 'NEAR_MISS', 'MINOR', 'SERIOUS', 'DEATH');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('OPEN', 'INVESTIGATING', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."leakage_method" AS ENUM('DIRECT', 'DIFFERENTIAL', 'ALTERNATIVE');--> statement-breakpoint
CREATE TYPE "public"."maintenance_strategy" AS ENUM('MANUFACTURER', 'ALTERNATIVE', 'RUN_TO_FAILURE');--> statement-breakpoint
CREATE TYPE "public"."protection_class" AS ENUM('I', 'II', 'INTERNAL');--> statement-breakpoint
CREATE TYPE "public"."safety_result" AS ENUM('PASS', 'FAIL');--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" varchar(24) NOT NULL,
	"facility_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"harm" "incident_harm" DEFAULT 'NONE' NOT NULL,
	"patient_involved" boolean DEFAULT false NOT NULL,
	"device_quarantined" boolean DEFAULT false NOT NULL,
	"immediate_action" text,
	"status" "incident_status" DEFAULT 'OPEN' NOT NULL,
	"root_cause" text,
	"corrective_action" text,
	"manufacturer_notified_on" date,
	"eda_notified_on" date,
	"eda_reference" text,
	"report_by" date,
	"work_order_id" integer,
	"recall_id" integer,
	"reported_by_id" integer,
	"reported_by_name" text,
	"closed_at" timestamp with time zone,
	"closed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "safety_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"work_order_id" integer,
	"tested_on" date NOT NULL,
	"tested_by_id" integer,
	"tested_by_name" text,
	"protection_class" "protection_class" NOT NULL,
	"applied_part" "applied_part" DEFAULT 'NONE' NOT NULL,
	"method" "leakage_method" DEFAULT 'DIRECT' NOT NULL,
	"visual_ok" boolean NOT NULL,
	"earth_resistance_ohm" real,
	"insulation_mohm" real,
	"equipment_leakage_ua" real,
	"applied_part_leakage_ua" real,
	"functional_ok" boolean NOT NULL,
	"analyser_asset_id" integer,
	"analyser_label" text,
	"analyser_calibration_due" date,
	"result" "safety_result" NOT NULL,
	"failures" text[] DEFAULT '{}'::text[] NOT NULL,
	"next_due" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "is_test_equipment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "calibration_due" date;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "calibration_cert_ref" text;--> statement-breakpoint
ALTER TABLE "device_types" ADD COLUMN "risk_function" integer;--> statement-breakpoint
ALTER TABLE "device_types" ADD COLUMN "risk_physical" integer;--> statement-breakpoint
ALTER TABLE "device_types" ADD COLUMN "risk_maintenance" integer;--> statement-breakpoint
ALTER TABLE "device_types" ADD COLUMN "maintenance_strategy" "maintenance_strategy";--> statement-breakpoint
ALTER TABLE "device_types" ADD COLUMN "strategy_reason" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_recall_id_recalls_id_fk" FOREIGN KEY ("recall_id") REFERENCES "public"."recalls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_tests" ADD CONSTRAINT "safety_tests_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_tests" ADD CONSTRAINT "safety_tests_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_tests" ADD CONSTRAINT "safety_tests_tested_by_id_users_id_fk" FOREIGN KEY ("tested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_tests" ADD CONSTRAINT "safety_tests_analyser_asset_id_assets_id_fk" FOREIGN KEY ("analyser_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incidents_asset_idx" ON "incidents" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "incidents_facility_idx" ON "incidents" USING btree ("facility_id","status");--> statement-breakpoint
CREATE INDEX "safety_tests_asset_idx" ON "safety_tests" USING btree ("asset_id","tested_on");