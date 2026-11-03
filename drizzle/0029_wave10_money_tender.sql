CREATE TYPE "public"."acceptance_status" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."bond_kind" AS ENUM('BID', 'PERFORMANCE', 'ADVANCE_PAYMENT');--> statement-breakpoint
CREATE TYPE "public"."bond_status" AS ENUM('HELD', 'RELEASED', 'CALLED');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('RECEIVED', 'MATCHED', 'EXCEPTION', 'APPROVED', 'PAID', 'REJECTED');--> statement-breakpoint
CREATE TABLE "acceptances" (
	"asset_id" integer PRIMARY KEY NOT NULL,
	"status" "acceptance_status" DEFAULT 'PENDING' NOT NULL,
	"results" jsonb,
	"delivered_on" date,
	"installed_on" date,
	"biomed_signed_by" text,
	"biomed_signed_at" timestamp with time zone,
	"department_signed_by" text,
	"department_signed_at" timestamp with time zone,
	"accepted_on" date,
	"issues" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bonds" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"offer_id" integer,
	"po_id" integer,
	"kind" "bond_kind" NOT NULL,
	"bank" text,
	"reference" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"issue_date" date,
	"expiry_date" date,
	"status" "bond_status" DEFAULT 'HELD' NOT NULL,
	"released_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"year" integer NOT NULL,
	"name" text NOT NULL,
	"department_id" integer,
	"project_id" integer,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'EGP' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "framework_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"framework_id" integer NOT NULL,
	"device_type_id" integer NOT NULL,
	"description" text NOT NULL,
	"manufacturer" text,
	"model" text,
	"unit_price" numeric(14, 2) NOT NULL,
	"max_qty" integer
);
--> statement-breakpoint
CREATE TABLE "frameworks" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" varchar(24) NOT NULL,
	"title" text NOT NULL,
	"supplier_id" integer NOT NULL,
	"facility_id" integer,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"currency" varchar(3) DEFAULT 'EGP' NOT NULL,
	"ceiling" numeric(14, 2) NOT NULL,
	"reference" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "frameworks_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"po_line_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" varchar(24) NOT NULL,
	"supplier_invoice_no" varchar(64) NOT NULL,
	"po_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date,
	"currency" varchar(3) NOT NULL,
	"status" "invoice_status" DEFAULT 'RECEIVED' NOT NULL,
	"decision_note" text,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"paid_at" date,
	"payment_reference" text,
	"notes" text,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "device_types" ADD COLUMN "acceptance_checklist" jsonb;--> statement-breakpoint
ALTER TABLE "offer_compliance" ADD COLUMN "page_ref" varchar(64);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "two_envelope" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "technical_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "financial_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "budget_line_id" integer;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "framework_id" integer;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonds" ADD CONSTRAINT "bonds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonds" ADD CONSTRAINT "bonds_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonds" ADD CONSTRAINT "bonds_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonds" ADD CONSTRAINT "bonds_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_items" ADD CONSTRAINT "framework_items_framework_id_frameworks_id_fk" FOREIGN KEY ("framework_id") REFERENCES "public"."frameworks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_items" ADD CONSTRAINT "framework_items_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frameworks" ADD CONSTRAINT "frameworks_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frameworks" ADD CONSTRAINT "frameworks_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_po_line_id_po_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."po_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bonds_project_idx" ON "bonds" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "budget_lines_facility_year_idx" ON "budget_lines" USING btree ("facility_id","year");--> statement-breakpoint
CREATE INDEX "framework_items_fw_idx" ON "framework_items" USING btree ("framework_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_po_idx" ON "invoices" USING btree ("po_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_supplier_no_uq" ON "invoices" USING btree ("supplier_id","supplier_invoice_no");--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_budget_line_id_budget_lines_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_framework_id_frameworks_id_fk" FOREIGN KEY ("framework_id") REFERENCES "public"."frameworks"("id") ON DELETE set null ON UPDATE no action;