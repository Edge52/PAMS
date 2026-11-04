CREATE TYPE "public"."budget_kind" AS ENUM('CAPITAL', 'MAINTENANCE');--> statement-breakpoint
CREATE TYPE "public"."contact_role" AS ENUM('SALES', 'SERVICE', 'FINANCE', 'MANAGEMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('SUBMITTED', 'APPROVED', 'REJECTED', 'PLANNED');--> statement-breakpoint
CREATE TYPE "public"."round_kind" AS ENUM('ROUND', 'STOCKTAKE');--> statement-breakpoint
CREATE TYPE "public"."round_result" AS ENUM('OK', 'FAULT', 'MOVED', 'MISSING', 'FOUND_ELSEWHERE');--> statement-breakpoint
CREATE TABLE "equipment_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" varchar(24) NOT NULL,
	"facility_id" integer NOT NULL,
	"department_id" integer,
	"device_type_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"replaces_asset_id" integer,
	"reason" text NOT NULL,
	"priority" "work_order_priority" DEFAULT 'NORMAL' NOT NULL,
	"needed_by" date,
	"status" "request_status" DEFAULT 'SUBMITTED' NOT NULL,
	"requested_by_id" integer,
	"requested_by_name" text,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"plan_year" integer,
	"boq_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_requests_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "round_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"round_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"result" "round_result" NOT NULL,
	"room_id" integer,
	"note" text,
	"work_order_id" integer,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"department_id" integer,
	"kind" "round_kind" DEFAULT 'ROUND' NOT NULL,
	"started_by_name" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "supplier_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_id" integer NOT NULL,
	"name" text NOT NULL,
	"role" "contact_role" DEFAULT 'SALES' NOT NULL,
	"job_title" text,
	"email" varchar(255),
	"phone" varchar(64),
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "kind" "budget_kind" DEFAULT 'CAPITAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_replaces_asset_id_assets_id_fk" FOREIGN KEY ("replaces_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_boq_id_boqs_id_fk" FOREIGN KEY ("boq_id") REFERENCES "public"."boqs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_items" ADD CONSTRAINT "round_items_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_items" ADD CONSTRAINT "round_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_items" ADD CONSTRAINT "round_items_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_items" ADD CONSTRAINT "round_items_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contacts" ADD CONSTRAINT "supplier_contacts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_requests_facility_idx" ON "equipment_requests" USING btree ("facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_items_round_asset_uq" ON "round_items" USING btree ("round_id","asset_id");--> statement-breakpoint
CREATE INDEX "rounds_facility_idx" ON "rounds" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "supplier_contacts_supplier_idx" ON "supplier_contacts" USING btree ("supplier_id");