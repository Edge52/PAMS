CREATE TYPE "public"."access_zone" AS ENUM('PUBLIC', 'PATIENT', 'STAFF', 'STERILE', 'ISOLATION');--> statement-breakpoint
CREATE TYPE "public"."route_fix_kind" AS ENUM('OPEN', 'CLOSE');--> statement-breakpoint
CREATE TABLE "route_fixes" (
	"id" serial PRIMARY KEY NOT NULL,
	"floor_id" integer NOT NULL,
	"kind" "route_fix_kind" NOT NULL,
	"x1" real NOT NULL,
	"y1" real NOT NULL,
	"x2" real NOT NULL,
	"y2" real NOT NULL,
	"note" text,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "zone" "access_zone";--> statement-breakpoint
ALTER TABLE "route_fixes" ADD CONSTRAINT "route_fixes_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "route_fixes_floor_idx" ON "route_fixes" USING btree ("floor_id");