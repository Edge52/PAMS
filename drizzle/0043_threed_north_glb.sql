ALTER TABLE "buildings" ADD COLUMN "north_deg" real;--> statement-breakpoint
ALTER TABLE "equipment_models" ADD COLUMN "glb_licence" text;--> statement-breakpoint
ALTER TABLE "equipment_models" ADD COLUMN "glb_credit" text;--> statement-breakpoint
ALTER TABLE "equipment_models" ADD COLUMN "glb_source" text;--> statement-breakpoint
ALTER TABLE "equipment_models" ADD COLUMN "glb_bytes" integer;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_north_check" CHECK ("buildings"."north_deg" is null or ("buildings"."north_deg" >= 0 and "buildings"."north_deg" < 360));--> statement-breakpoint
ALTER TABLE "equipment_models" ADD CONSTRAINT "equipment_models_glb_bytes_check" CHECK ("equipment_models"."glb_bytes" is null or "equipment_models"."glb_bytes" > 0);