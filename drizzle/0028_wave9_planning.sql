CREATE TABLE "capital_budgets" (
	"facility_id" integer NOT NULL,
	"year" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'EGP' NOT NULL,
	"notes" text,
	CONSTRAINT "capital_budgets_facility_id_year_pk" PRIMARY KEY("facility_id","year")
);
--> statement-breakpoint
CREATE TABLE "imaging_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"month" date NOT NULL,
	"exams" integer NOT NULL,
	"scheduled_hours" real,
	"notes" text,
	"entered_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "type_capacity" (
	"device_type_id" integer PRIMARY KEY NOT NULL,
	"exams_per_year" integer NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "tco_service_annual" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "tco_consumables_annual" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "tco_energy_annual" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "tco_other_annual" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "tco_uptime_pct" real;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD COLUMN "repair_hours" integer;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD COLUMN "uptime_pct" real;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD COLUMN "penalty_per_late_hour" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "service_contracts" ADD COLUMN "penalty_per_uptime_point" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "service_contracts" ADD COLUMN "penalty_cap_pct" real;--> statement-breakpoint
ALTER TABLE "capital_budgets" ADD CONSTRAINT "capital_budgets_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_usage" ADD CONSTRAINT "imaging_usage_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "type_capacity" ADD CONSTRAINT "type_capacity_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "imaging_usage_asset_month_uq" ON "imaging_usage" USING btree ("asset_id","month");