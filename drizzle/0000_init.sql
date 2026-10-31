CREATE TYPE "public"."asset_condition" AS ENUM('NEW', 'GOOD', 'FAIR', 'POOR', 'CONDEMNED');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('IN_STOCK', 'INSTALLED', 'IN_SERVICE', 'UNDER_MAINTENANCE', 'OUT_OF_SERVICE', 'DISPOSED');--> statement-breakpoint
CREATE TYPE "public"."boq_basis" AS ENUM('PER_BED', 'PER_ROOM', 'PER_DEPARTMENT', 'PER_HOSPITAL_BEDS', 'FIXED');--> statement-breakpoint
CREATE TYPE "public"."boq_status" AS ENUM('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."boq_tier" AS ENUM('ESSENTIAL', 'RECOMMENDED', 'OPTIONAL');--> statement-breakpoint
CREATE TYPE "public"."compliance_status" AS ENUM('COMPLIES', 'PARTIAL', 'NOT_COMPLIANT', 'NOT_STATED');--> statement-breakpoint
CREATE TYPE "public"."criticality" AS ENUM('LIFE_SUPPORT', 'HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."facility_type" AS ENUM('GENERAL_HOSPITAL', 'SPECIALIZED_HOSPITAL', 'UNIVERSITY_HOSPITAL', 'MEDICAL_CENTER', 'CLINIC', 'DIAGNOSTIC_CENTER');--> statement-breakpoint
CREATE TYPE "public"."incoterm" AS ENUM('EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'OVERDUE');--> statement-breakpoint
CREATE TYPE "public"."maintenance_type" AS ENUM('PPM', 'CORRECTIVE', 'CALIBRATION', 'INSPECTION', 'SAFETY_TEST');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('RECEIVED', 'UNDER_REVIEW', 'SHORTLISTED', 'REJECTED', 'AWARDED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."po_status" AS ENUM('DRAFT', 'ISSUED', 'ACKNOWLEDGED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('PLANNING', 'SPECIFICATION', 'RFQ', 'EVALUATION', 'AWARDED', 'DELIVERY', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."rfq_status" AS ENUM('DRAFT', 'ISSUED', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."risk_class" AS ENUM('I', 'IIa', 'IIb', 'III');--> statement-breakpoint
CREATE TYPE "public"."room_type" AS ENUM('PATIENT_ROOM', 'WARD', 'ICU_BAY', 'OPERATING_ROOM', 'PROCEDURE_ROOM', 'IMAGING_ROOM', 'LAB', 'PHARMACY', 'CONSULTATION', 'NURSE_STATION', 'STORE', 'CORRIDOR', 'WAITING', 'OFFICE', 'TECHNICAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."rounding" AS ENUM('CEIL', 'ROUND', 'FLOOR');--> statement-breakpoint
CREATE TYPE "public"."rule_confidence" AS ENUM('SOURCED', 'INDUSTRY_PRACTICE', 'DRAFT');--> statement-breakpoint
CREATE TYPE "public"."supplier_type" AS ENUM('MANUFACTURER', 'DISTRIBUTOR', 'AGENT', 'SERVICE_PROVIDER');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'PROCUREMENT', 'BIOMEDICAL', 'FINANCE', 'DEPARTMENT_HEAD', 'VIEWER');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"entity_id" integer NOT NULL,
	"action" varchar(48) NOT NULL,
	"summary" text NOT NULL,
	"actor" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"from_room_id" integer,
	"to_room_id" integer,
	"from_department_id" integer,
	"to_department_id" integer,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"moved_by" text
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_tag" varchar(48) NOT NULL,
	"device_type_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"department_id" integer,
	"room_id" integer,
	"pos_x" real,
	"pos_y" real,
	"parent_asset_id" integer,
	"manufacturer" text,
	"model" text,
	"serial_number" varchar(128),
	"status" "asset_status" DEFAULT 'IN_STOCK' NOT NULL,
	"condition" "asset_condition" DEFAULT 'NEW' NOT NULL,
	"criticality" "criticality",
	"supplier_id" integer,
	"po_line_id" integer,
	"delivery_line_id" integer,
	"purchase_cost" numeric(14, 2),
	"currency" varchar(3),
	"purchase_date" date,
	"install_date" date,
	"warranty_end" date,
	"life_expectancy_years" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_asset_tag_unique" UNIQUE("asset_tag")
);
--> statement-breakpoint
CREATE TABLE "boq_departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"boq_id" integer NOT NULL,
	"department_type_code" varchar(32) NOT NULL,
	"department_id" integer,
	"label" text NOT NULL,
	"beds" integer DEFAULT 0 NOT NULL,
	"rooms" integer DEFAULT 0 NOT NULL,
	"instances" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boq_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"boq_id" integer NOT NULL,
	"boq_department_id" integer,
	"device_type_id" integer NOT NULL,
	"rule_id" integer,
	"tier" "boq_tier" DEFAULT 'ESSENTIAL' NOT NULL,
	"calculated_qty" integer DEFAULT 0 NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"is_overridden" boolean DEFAULT false NOT NULL,
	"is_manual" boolean DEFAULT false NOT NULL,
	"unit_price_estimate" numeric(14, 2),
	"calc_explanation" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "boq_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"standard_set_id" integer NOT NULL,
	"department_type_code" varchar(32) NOT NULL,
	"device_type_id" integer NOT NULL,
	"basis" "boq_basis" NOT NULL,
	"ratio" real NOT NULL,
	"min_qty" integer DEFAULT 0 NOT NULL,
	"max_qty" integer,
	"rounding" "rounding" DEFAULT 'CEIL' NOT NULL,
	"tier" "boq_tier" DEFAULT 'ESSENTIAL' NOT NULL,
	"confidence" "rule_confidence" DEFAULT 'DRAFT' NOT NULL,
	"source_ref" varchar(64),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "boqs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"facility_id" integer,
	"project_id" integer,
	"standard_set_id" integer NOT NULL,
	"status" "boq_status" DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"total_hospital_beds" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"contingency_pct" real DEFAULT 0 NOT NULL,
	"include_tiers" "boq_tier"[] DEFAULT ARRAY['ESSENTIAL','RECOMMENDED']::boq_tier[] NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buildings" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_id" integer NOT NULL,
	"reference" varchar(64) NOT NULL,
	"delivery_date" date NOT NULL,
	"received_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"delivery_id" integer NOT NULL,
	"po_line_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"serial_numbers" text[]
);
--> statement-breakpoint
CREATE TABLE "department_types" (
	"code" varchar(32) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"category" text,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"department_type_code" varchar(32),
	"code" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"beds" integer DEFAULT 0 NOT NULL,
	"head_name" text,
	"cost_center" varchar(32)
);
--> statement-breakpoint
CREATE TABLE "device_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(48) NOT NULL,
	"parent_id" integer,
	"level" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"description" text,
	"umdns_code" varchar(16),
	"gmdn_term" text,
	"risk_class" "risk_class",
	"criticality" "criticality",
	"life_expectancy_years" integer,
	"ppm_interval_months" integer,
	"requires_calibration" boolean DEFAULT false NOT NULL,
	"is_capital" boolean DEFAULT true NOT NULL,
	"price_min_usd" numeric(14, 2),
	"price_max_usd" numeric(14, 2),
	"spec_template" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "device_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"entity_id" integer NOT NULL,
	"kind" varchar(32),
	"file_name" text NOT NULL,
	"url" text NOT NULL,
	"size_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"currency" varchar(3) NOT NULL,
	"rate_to_egp" numeric(14, 6) NOT NULL,
	"effective_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"type" "facility_type" DEFAULT 'GENERAL_HOSPITAL' NOT NULL,
	"governorate" text,
	"city" text,
	"address" text,
	"total_beds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facilities_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "floors" (
	"id" serial PRIMARY KEY NOT NULL,
	"building_id" integer NOT NULL,
	"level" integer NOT NULL,
	"name" text NOT NULL,
	"plan_image_url" text,
	"plan_width" integer DEFAULT 1000 NOT NULL,
	"plan_height" integer DEFAULT 600 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"type" "maintenance_type" NOT NULL,
	"status" "maintenance_status" DEFAULT 'SCHEDULED' NOT NULL,
	"scheduled_date" date,
	"completed_date" date,
	"performed_by" text,
	"vendor_id" integer,
	"cost" numeric(14, 2),
	"currency" varchar(3),
	"downtime_hours" real,
	"findings" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_compliance" (
	"id" serial PRIMARY KEY NOT NULL,
	"offer_line_id" integer NOT NULL,
	"spec_item_id" integer NOT NULL,
	"offered_value" text,
	"status" "compliance_status" DEFAULT 'NOT_STATED' NOT NULL,
	"remark" text
);
--> statement-breakpoint
CREATE TABLE "offer_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"offer_id" integer NOT NULL,
	"boq_line_id" integer,
	"device_type_id" integer NOT NULL,
	"spec_id" integer,
	"description" text NOT NULL,
	"manufacturer" text,
	"model" text,
	"country_of_origin" text,
	"quantity" integer NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"discount_pct" real DEFAULT 0 NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"rfq_id" integer,
	"supplier_id" integer NOT NULL,
	"reference" varchar(64) NOT NULL,
	"offer_date" date NOT NULL,
	"valid_until" date,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"incoterm" "incoterm",
	"delivery_weeks" integer,
	"warranty_months" integer,
	"payment_terms" text,
	"status" "offer_status" DEFAULT 'RECEIVED' NOT NULL,
	"technical_score" real,
	"financial_score" real,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "po_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_id" integer NOT NULL,
	"offer_line_id" integer,
	"device_type_id" integer NOT NULL,
	"description" text NOT NULL,
	"manufacturer" text,
	"model" text,
	"quantity" integer NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"received_qty" integer DEFAULT 0 NOT NULL,
	"destination_department_id" integer
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(48) NOT NULL,
	"title" text NOT NULL,
	"facility_id" integer,
	"client" text,
	"status" "project_status" DEFAULT 'PLANNING' NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"budget" numeric(14, 2),
	"submission_deadline" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" varchar(48) NOT NULL,
	"project_id" integer,
	"supplier_id" integer NOT NULL,
	"offer_id" integer,
	"facility_id" integer,
	"status" "po_status" DEFAULT 'DRAFT' NOT NULL,
	"issue_date" date,
	"expected_delivery" date,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"incoterm" "incoterm",
	"payment_terms" text,
	"warranty_months" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "rfq_suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfq_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"invited_at" date,
	"responded" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfqs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"number" varchar(48) NOT NULL,
	"title" text NOT NULL,
	"status" "rfq_status" DEFAULT 'DRAFT' NOT NULL,
	"issue_date" date,
	"closing_date" date,
	"boq_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfqs_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"floor_id" integer NOT NULL,
	"department_id" integer,
	"code" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"type" "room_type" DEFAULT 'OTHER' NOT NULL,
	"beds" integer DEFAULT 0 NOT NULL,
	"x" real DEFAULT 0 NOT NULL,
	"y" real DEFAULT 0 NOT NULL,
	"w" real DEFAULT 100 NOT NULL,
	"h" real DEFAULT 80 NOT NULL,
	"polygon" jsonb
);
--> statement-breakpoint
CREATE TABLE "spec_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"spec_id" integer NOT NULL,
	"section" text,
	"parameter" text NOT NULL,
	"requirement" text NOT NULL,
	"unit" varchar(32),
	"mandatory" boolean DEFAULT true NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standard_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(48) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version" varchar(16) DEFAULT '1.0' NOT NULL,
	"sources" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standard_sets_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "supplier_type" DEFAULT 'DISTRIBUTOR' NOT NULL,
	"country" text,
	"brands" text[],
	"contact_name" text,
	"email" varchar(255),
	"phone" varchar(64),
	"address" text,
	"tax_id" varchar(64),
	"commercial_register" varchar(64),
	"rating" real,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tech_specs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"device_type_id" integer NOT NULL,
	"title" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" "user_role" DEFAULT 'VIEWER' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_from_room_id_rooms_id_fk" FOREIGN KEY ("from_room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_to_room_id_rooms_id_fk" FOREIGN KEY ("to_room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_from_department_id_departments_id_fk" FOREIGN KEY ("from_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_to_department_id_departments_id_fk" FOREIGN KEY ("to_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_parent_asset_id_assets_id_fk" FOREIGN KEY ("parent_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_po_line_id_po_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."po_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_delivery_line_id_delivery_lines_id_fk" FOREIGN KEY ("delivery_line_id") REFERENCES "public"."delivery_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_departments" ADD CONSTRAINT "boq_departments_boq_id_boqs_id_fk" FOREIGN KEY ("boq_id") REFERENCES "public"."boqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_departments" ADD CONSTRAINT "boq_departments_department_type_code_department_types_code_fk" FOREIGN KEY ("department_type_code") REFERENCES "public"."department_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_departments" ADD CONSTRAINT "boq_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_lines" ADD CONSTRAINT "boq_lines_boq_id_boqs_id_fk" FOREIGN KEY ("boq_id") REFERENCES "public"."boqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_lines" ADD CONSTRAINT "boq_lines_boq_department_id_boq_departments_id_fk" FOREIGN KEY ("boq_department_id") REFERENCES "public"."boq_departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_lines" ADD CONSTRAINT "boq_lines_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_lines" ADD CONSTRAINT "boq_lines_rule_id_boq_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."boq_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_rules" ADD CONSTRAINT "boq_rules_standard_set_id_standard_sets_id_fk" FOREIGN KEY ("standard_set_id") REFERENCES "public"."standard_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_rules" ADD CONSTRAINT "boq_rules_department_type_code_department_types_code_fk" FOREIGN KEY ("department_type_code") REFERENCES "public"."department_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_rules" ADD CONSTRAINT "boq_rules_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boqs" ADD CONSTRAINT "boqs_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boqs" ADD CONSTRAINT "boqs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boqs" ADD CONSTRAINT "boqs_standard_set_id_standard_sets_id_fk" FOREIGN KEY ("standard_set_id") REFERENCES "public"."standard_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_po_line_id_po_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."po_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_department_type_code_department_types_code_fk" FOREIGN KEY ("department_type_code") REFERENCES "public"."department_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_types" ADD CONSTRAINT "device_types_parent_id_device_types_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."device_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_events_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_events_vendor_id_suppliers_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_compliance" ADD CONSTRAINT "offer_compliance_offer_line_id_offer_lines_id_fk" FOREIGN KEY ("offer_line_id") REFERENCES "public"."offer_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_compliance" ADD CONSTRAINT "offer_compliance_spec_item_id_spec_items_id_fk" FOREIGN KEY ("spec_item_id") REFERENCES "public"."spec_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_lines" ADD CONSTRAINT "offer_lines_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_lines" ADD CONSTRAINT "offer_lines_boq_line_id_boq_lines_id_fk" FOREIGN KEY ("boq_line_id") REFERENCES "public"."boq_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_lines" ADD CONSTRAINT "offer_lines_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_lines" ADD CONSTRAINT "offer_lines_spec_id_tech_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."tech_specs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_offer_line_id_offer_lines_id_fk" FOREIGN KEY ("offer_line_id") REFERENCES "public"."offer_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_destination_department_id_departments_id_fk" FOREIGN KEY ("destination_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_boq_id_boqs_id_fk" FOREIGN KEY ("boq_id") REFERENCES "public"."boqs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_items" ADD CONSTRAINT "spec_items_spec_id_tech_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."tech_specs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_specs" ADD CONSTRAINT "tech_specs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_specs" ADD CONSTRAINT "tech_specs_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_entity_idx" ON "activity_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "assets_room_idx" ON "assets" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "assets_department_idx" ON "assets" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "assets_device_type_idx" ON "assets" USING btree ("device_type_id");--> statement-breakpoint
CREATE INDEX "assets_facility_idx" ON "assets" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "boq_lines_boq_idx" ON "boq_lines" USING btree ("boq_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boq_rules_uq" ON "boq_rules" USING btree ("standard_set_id","department_type_code","device_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "buildings_facility_code_uq" ON "buildings" USING btree ("facility_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_facility_code_uq" ON "departments" USING btree ("facility_id","code");--> statement-breakpoint
CREATE INDEX "device_types_parent_idx" ON "device_types" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "documents_entity_idx" ON "documents" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_currency_date_uq" ON "exchange_rates" USING btree ("currency","effective_date");--> statement-breakpoint
CREATE UNIQUE INDEX "floors_building_level_uq" ON "floors" USING btree ("building_id","level");--> statement-breakpoint
CREATE INDEX "maintenance_asset_idx" ON "maintenance_events" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_compliance_uq" ON "offer_compliance" USING btree ("offer_line_id","spec_item_id");--> statement-breakpoint
CREATE INDEX "offers_project_idx" ON "offers" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_suppliers_uq" ON "rfq_suppliers" USING btree ("rfq_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_floor_code_uq" ON "rooms" USING btree ("floor_id","code");--> statement-breakpoint
CREATE INDEX "rooms_department_idx" ON "rooms" USING btree ("department_id");