CREATE TABLE "site_requirements" (
	"model_id" integer PRIMARY KEY NOT NULL,
	"length_m" real NOT NULL,
	"width_m" real NOT NULL,
	"height_m" real,
	"clearance_m" real DEFAULT 0.6 NOT NULL,
	"min_room_length_m" real,
	"min_room_width_m" real,
	"min_area_m2" real,
	"min_ceiling_m" real,
	"door_width_m" real,
	"door_height_m" real,
	"weight_kg" real,
	"power_kva" real,
	"heat_kw" real,
	"chilled_water" boolean DEFAULT false NOT NULL,
	"quench_pipe" boolean DEFAULT false NOT NULL,
	"rf_shield" boolean DEFAULT false NOT NULL,
	"lead_lined" boolean DEFAULT false NOT NULL,
	"fringe_along_m" real,
	"fringe_across_m" real,
	"source" text,
	"verified" boolean DEFAULT false NOT NULL,
	"notes" text,
	"updated_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "ceiling_m" real;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "door_width_m" real;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "door_height_m" real;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "floor_load_kg_m2" real;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "services" jsonb;--> statement-breakpoint
ALTER TABLE "site_requirements" ADD CONSTRAINT "site_requirements_model_id_device_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."device_models"("id") ON DELETE cascade ON UPDATE no action;