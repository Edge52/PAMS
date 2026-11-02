CREATE TYPE "public"."twin_note_status" AS ENUM('OPEN', 'DONE');--> statement-breakpoint
CREATE TABLE "twin_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"floor_id" integer NOT NULL,
	"room_id" integer,
	"asset_id" integer,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"text" text NOT NULL,
	"status" "twin_note_status" DEFAULT 'OPEN' NOT NULL,
	"assignee_id" integer,
	"assignee_name" text,
	"created_by_id" integer,
	"created_by_name" text,
	"work_order_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_name" text
);
--> statement-breakpoint
ALTER TABLE "twin_notes" ADD CONSTRAINT "twin_notes_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_notes" ADD CONSTRAINT "twin_notes_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_notes" ADD CONSTRAINT "twin_notes_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_notes" ADD CONSTRAINT "twin_notes_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_notes" ADD CONSTRAINT "twin_notes_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_notes" ADD CONSTRAINT "twin_notes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_notes" ADD CONSTRAINT "twin_notes_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "twin_notes_facility_idx" ON "twin_notes" USING btree ("facility_id","status");