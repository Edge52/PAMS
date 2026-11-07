CREATE TABLE "sim_scenarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_by_id" integer,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sim_scenarios" ADD CONSTRAINT "sim_scenarios_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_scenarios" ADD CONSTRAINT "sim_scenarios_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sim_scenarios_facility_idx" ON "sim_scenarios" USING btree ("facility_id");