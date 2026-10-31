CREATE TYPE "public"."part_txn_kind" AS ENUM('RECEIPT', 'ISSUE', 'RETURN', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."recall_action" AS ENUM('INSPECT', 'SOFTWARE_UPDATE', 'MODIFY', 'REPLACE_PART', 'REMOVE_FROM_USE', 'ADVISORY');--> statement-breakpoint
CREATE TYPE "public"."recall_asset_status" AS ENUM('PENDING', 'ACTIONED', 'NOT_AFFECTED');--> statement-breakpoint
CREATE TYPE "public"."recall_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TABLE "part_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"part_id" integer NOT NULL,
	"kind" "part_txn_kind" NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost" numeric(14, 2),
	"work_order_id" integer,
	"note" text,
	"actor" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recall_assets" (
	"recall_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"status" "recall_asset_status" DEFAULT 'PENDING' NOT NULL,
	"work_order_id" integer,
	"actioned_at" timestamp with time zone,
	"note" text,
	CONSTRAINT "recall_assets_recall_id_asset_id_pk" PRIMARY KEY("recall_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "recalls" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" varchar(24) NOT NULL,
	"reference" text,
	"source" text,
	"title" text NOT NULL,
	"description" text,
	"manufacturer" text,
	"device_type_id" integer,
	"model_pattern" text,
	"serial_numbers" text[],
	"action" "recall_action" DEFAULT 'INSPECT' NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"issued_date" date,
	"due_date" date,
	"status" "recall_status" DEFAULT 'OPEN' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recalls_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "spare_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"part_number" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"manufacturer" text,
	"device_type_id" integer,
	"supplier_id" integer,
	"unit_cost" numeric(14, 2),
	"currency" varchar(3),
	"stock_qty" integer DEFAULT 0 NOT NULL,
	"min_qty" integer DEFAULT 0 NOT NULL,
	"location" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "part_transactions" ADD CONSTRAINT "part_transactions_part_id_spare_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."spare_parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_transactions" ADD CONSTRAINT "part_transactions_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_assets" ADD CONSTRAINT "recall_assets_recall_id_recalls_id_fk" FOREIGN KEY ("recall_id") REFERENCES "public"."recalls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_assets" ADD CONSTRAINT "recall_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_assets" ADD CONSTRAINT "recall_assets_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_parts" ADD CONSTRAINT "spare_parts_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_parts" ADD CONSTRAINT "spare_parts_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_parts" ADD CONSTRAINT "spare_parts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "part_txn_part_idx" ON "part_transactions" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "part_txn_wo_idx" ON "part_transactions" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "recall_assets_asset_idx" ON "recall_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "recall_assets_wo_idx" ON "recall_assets" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spare_parts_facility_number_uq" ON "spare_parts" USING btree ("facility_id","part_number");--> statement-breakpoint
CREATE INDEX "spare_parts_type_idx" ON "spare_parts" USING btree ("device_type_id");