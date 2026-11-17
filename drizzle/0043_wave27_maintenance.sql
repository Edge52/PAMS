CREATE TYPE "public"."loan_direction" AS ENUM('BORROWED', 'LENT');--> statement-breakpoint
CREATE TYPE "public"."meter_reading_kind" AS ENUM('READING', 'RESET');--> statement-breakpoint
CREATE TYPE "public"."training_kind" AS ENUM('INITIAL', 'REFRESHER', 'SUPPLIER');--> statement-breakpoint
CREATE TABLE "equipment_loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" varchar(24) NOT NULL,
	"facility_id" integer NOT NULL,
	"direction" "loan_direction" NOT NULL,
	"is_rental" boolean DEFAULT false NOT NULL,
	"other_party" text NOT NULL,
	"supplier_id" integer,
	"asset_id" integer,
	"device_description" text,
	"serial_number" varchar(128),
	"department_id" integer,
	"purpose" text,
	"out_on" date NOT NULL,
	"due_back_on" date,
	"returned_on" date,
	"condition_out" text,
	"condition_in" text,
	"cost" numeric(14, 2),
	"currency" varchar(3),
	"check_ppm_ok" boolean,
	"check_safety_ok" boolean,
	"check_note" text,
	"checked_on" date,
	"checked_by_id" integer,
	"checked_by_name" text,
	"notes" text,
	"created_by_id" integer,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_loans_number_unique" UNIQUE("number"),
	CONSTRAINT "equipment_loans_dates_check" CHECK (("equipment_loans"."due_back_on" is null or "equipment_loans"."due_back_on" >= "equipment_loans"."out_on") and ("equipment_loans"."returned_on" is null or "equipment_loans"."returned_on" >= "equipment_loans"."out_on")),
	CONSTRAINT "equipment_loans_cost_check" CHECK ("equipment_loans"."cost" is null or "equipment_loans"."cost" >= 0),
	CONSTRAINT "equipment_loans_device_check" CHECK ("equipment_loans"."asset_id" is not null or "equipment_loans"."device_description" is not null)
);
--> statement-breakpoint
CREATE TABLE "maintenance_test_equipment" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"asset_id" integer,
	"label" text NOT NULL,
	"calibration_due" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meter_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"read_on" date NOT NULL,
	"reading" double precision NOT NULL,
	"unit" varchar(16) NOT NULL,
	"kind" "meter_reading_kind" DEFAULT 'READING' NOT NULL,
	"note" text,
	"entered_by_id" integer,
	"entered_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meter_readings_reading_check" CHECK ("meter_readings"."reading" >= 0)
);
--> statement-breakpoint
CREATE TABLE "training_attendees" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"user_id" integer,
	"name" text NOT NULL,
	"department_id" integer,
	"department_text" text
);
--> statement-breakpoint
CREATE TABLE "training_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"device_type_id" integer NOT NULL,
	"held_on" date NOT NULL,
	"trainer" text NOT NULL,
	"kind" "training_kind" DEFAULT 'INITIAL' NOT NULL,
	"department_id" integer,
	"notes" text,
	"created_by_id" integer,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_types" ADD COLUMN "usage_interval" integer;--> statement-breakpoint
ALTER TABLE "device_types" ADD COLUMN "usage_unit" varchar(16);--> statement-breakpoint
ALTER TABLE "equipment_loans" ADD CONSTRAINT "equipment_loans_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_loans" ADD CONSTRAINT "equipment_loans_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_loans" ADD CONSTRAINT "equipment_loans_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_loans" ADD CONSTRAINT "equipment_loans_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_loans" ADD CONSTRAINT "equipment_loans_checked_by_id_users_id_fk" FOREIGN KEY ("checked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_loans" ADD CONSTRAINT "equipment_loans_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_test_equipment" ADD CONSTRAINT "maintenance_test_equipment_event_id_maintenance_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."maintenance_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_test_equipment" ADD CONSTRAINT "maintenance_test_equipment_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_entered_by_id_users_id_fk" FOREIGN KEY ("entered_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_attendees" ADD CONSTRAINT "training_attendees_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_attendees" ADD CONSTRAINT "training_attendees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_attendees" ADD CONSTRAINT "training_attendees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_loans_facility_idx" ON "equipment_loans" USING btree ("facility_id","returned_on");--> statement-breakpoint
CREATE INDEX "equipment_loans_asset_idx" ON "equipment_loans" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_test_equipment_uq" ON "maintenance_test_equipment" USING btree ("event_id","asset_id");--> statement-breakpoint
CREATE INDEX "maintenance_test_equipment_asset_idx" ON "maintenance_test_equipment" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "meter_readings_asset_idx" ON "meter_readings" USING btree ("asset_id","read_on");--> statement-breakpoint
CREATE INDEX "training_attendees_session_idx" ON "training_attendees" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "training_attendees_user_idx" ON "training_attendees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "training_sessions_type_idx" ON "training_sessions" USING btree ("facility_id","device_type_id","held_on");