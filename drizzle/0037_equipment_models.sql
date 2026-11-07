CREATE TABLE "equipment_models" (
	"model_id" integer PRIMARY KEY NOT NULL,
	"glb_url" text,
	"glb_name" text,
	"zones" jsonb,
	"connections" jsonb,
	"updated_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "equipment_models" ADD CONSTRAINT "equipment_models_model_id_device_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."device_models"("id") ON DELETE cascade ON UPDATE no action;