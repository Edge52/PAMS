CREATE TABLE "twin_tours" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"name" text NOT NULL,
	"stops" jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_by_id" integer,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "twin_tours" ADD CONSTRAINT "twin_tours_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_tours" ADD CONSTRAINT "twin_tours_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "twin_tours_facility_idx" ON "twin_tours" USING btree ("facility_id");