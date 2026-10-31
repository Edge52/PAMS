CREATE TYPE "public"."claim_status" AS ENUM('NOT_CLAIMED', 'SUBMITTED', 'ACCEPTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."contract_type" AS ENUM('FULL_SERVICE', 'PREVENTIVE', 'PARTS_ONLY', 'LABOUR_ONLY', 'WARRANTY_EXTENSION');--> statement-breakpoint
CREATE TYPE "public"."work_order_coverage" AS ENUM('NONE', 'WARRANTY', 'CONTRACT');--> statement-breakpoint
CREATE TABLE "service_contract_assets" (
	"contract_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	CONSTRAINT "service_contract_assets_contract_id_asset_id_pk" PRIMARY KEY("contract_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "service_contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" varchar(24) NOT NULL,
	"facility_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"title" text NOT NULL,
	"type" "contract_type" DEFAULT 'FULL_SERVICE' NOT NULL,
	"vendor_reference" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"value" numeric(14, 2),
	"currency" varchar(3),
	"response_hours" integer,
	"ppm_visits_per_year" integer,
	"includes_parts" boolean DEFAULT false NOT NULL,
	"contact_name" text,
	"contact_phone" varchar(48),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_contracts_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "device_types" ADD COLUMN "ppm_checklist" jsonb;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "planned_event_id" integer;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "checklist" jsonb;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "coverage" "work_order_coverage" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "contract_id" integer;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "claim_status" "claim_status" DEFAULT 'NOT_CLAIMED' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "claim_reference" text;--> statement-breakpoint
ALTER TABLE "service_contract_assets" ADD CONSTRAINT "service_contract_assets_contract_id_service_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."service_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_contract_assets" ADD CONSTRAINT "service_contract_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_contract_assets_asset_idx" ON "service_contract_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "service_contracts_facility_idx" ON "service_contracts" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "service_contracts_end_idx" ON "service_contracts" USING btree ("end_date");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_planned_event_id_maintenance_events_id_fk" FOREIGN KEY ("planned_event_id") REFERENCES "public"."maintenance_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_contract_id_service_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."service_contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_planned_event_uq" ON "work_orders" USING btree ("planned_event_id");