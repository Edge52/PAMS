CREATE TYPE "public"."flow_kind" AS ENUM('PATIENT', 'STAFF', 'SUPPLIES', 'WASTE');--> statement-breakpoint
CREATE TYPE "public"."flow_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."flow_step_kind" AS ENUM('START', 'STEP', 'END');--> statement-breakpoint
CREATE TYPE "public"."flow_transport" AS ENUM('FOOT', 'WHEELCHAIR', 'TROLLEY', 'BED');--> statement-breakpoint
CREATE TYPE "public"."flow_urgency" AS ENUM('ROUTINE', 'URGENT');--> statement-breakpoint
CREATE TABLE "flow_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"flow_id" integer NOT NULL,
	"from_key" varchar(24) NOT NULL,
	"to_key" varchar(24) NOT NULL,
	"share" integer DEFAULT 100 NOT NULL,
	"transport" "flow_transport" DEFAULT 'FOOT' NOT NULL,
	"urgency" "flow_urgency" DEFAULT 'ROUTINE' NOT NULL,
	"condition" text
);
--> statement-breakpoint
CREATE TABLE "flow_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"flow_id" integer NOT NULL,
	"key" varchar(24) NOT NULL,
	"label" text NOT NULL,
	"kind" "flow_step_kind" DEFAULT 'STEP' NOT NULL,
	"department_id" integer,
	"room_id" integer,
	"minutes" integer,
	"accompanying" text,
	"equipment" jsonb,
	"notes" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"x" real,
	"y" real
);
--> statement-breakpoint
CREATE TABLE "patient_flows" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"lineage_id" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"kind" "flow_kind" DEFAULT 'PATIENT' NOT NULL,
	"status" "flow_status" DEFAULT 'DRAFT' NOT NULL,
	"daily_volume" integer,
	"arrival_profile" jsonb,
	"description" text,
	"starter" varchar(32),
	"owner_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "flow_links" ADD CONSTRAINT "flow_links_flow_id_patient_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."patient_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_steps" ADD CONSTRAINT "flow_steps_flow_id_patient_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."patient_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_steps" ADD CONSTRAINT "flow_steps_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_steps" ADD CONSTRAINT "flow_steps_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_flows" ADD CONSTRAINT "patient_flows_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flow_links_flow_idx" ON "flow_links" USING btree ("flow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_steps_key_uq" ON "flow_steps" USING btree ("flow_id","key");--> statement-breakpoint
CREATE INDEX "patient_flows_facility_idx" ON "patient_flows" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "patient_flows_lineage_idx" ON "patient_flows" USING btree ("lineage_id");