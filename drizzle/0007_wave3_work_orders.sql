CREATE TYPE "public"."work_order_priority" AS ENUM('URGENT', 'HIGH', 'NORMAL', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" varchar(24) NOT NULL,
	"asset_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"type" "maintenance_type" DEFAULT 'CORRECTIVE' NOT NULL,
	"priority" "work_order_priority" DEFAULT 'NORMAL' NOT NULL,
	"status" "work_order_status" DEFAULT 'OPEN' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"device_down" boolean DEFAULT false NOT NULL,
	"reported_by_id" integer,
	"reported_by_name" text,
	"reporter_contact" text,
	"assigned_to_id" integer,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"assigned_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"downtime_start" timestamp with time zone,
	"downtime_end" timestamp with time zone,
	"hold_reason" text,
	"resolution" text,
	"root_cause" text,
	"labor_hours" real,
	"cost" numeric(14, 2),
	"currency" varchar(3),
	"maintenance_event_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_maintenance_event_id_maintenance_events_id_fk" FOREIGN KEY ("maintenance_event_id") REFERENCES "public"."maintenance_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_orders_asset_idx" ON "work_orders" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "work_orders_status_idx" ON "work_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "work_orders_assignee_idx" ON "work_orders" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE INDEX "work_orders_facility_idx" ON "work_orders" USING btree ("facility_id");--> statement-breakpoint
-- La Plaza floor-to-floor height is 5 m (was assumed 4.5 m). Only floors still on the old assumed value are changed.
UPDATE "floors" SET "elevation" = "level" * 5 WHERE "elevation" IS NOT NULL AND abs("elevation" - "level" * 4.5) < 0.001 AND "level" <> 0;
