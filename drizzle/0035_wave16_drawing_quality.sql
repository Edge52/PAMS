ALTER TABLE "floor_cad" ADD COLUMN "alignment" jsonb;--> statement-breakpoint
ALTER TABLE "floor_cad" ADD COLUMN "revision" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "outline_source" varchar(16);--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "verified_by_name" text;