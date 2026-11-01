CREATE TYPE "public"."lift_kind" AS ENUM('BED', 'PUBLIC', 'SERVICE', 'AGV');--> statement-breakpoint
CREATE TABLE "lift_cores" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" "lift_kind" NOT NULL,
	"stops" jsonb NOT NULL,
	"cars" integer DEFAULT 1 NOT NULL,
	"car_capacity" integer,
	"wait_seconds" integer DEFAULT 45 NOT NULL,
	"inferred" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lift_cores" ADD CONSTRAINT "lift_cores_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lift_cores_facility_idx" ON "lift_cores" USING btree ("facility_id");