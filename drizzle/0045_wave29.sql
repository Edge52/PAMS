ALTER TYPE "public"."asset_status" ADD VALUE 'ON_LOAN';--> statement-breakpoint
ALTER TABLE "equipment_loans" ADD COLUMN "status_before" varchar(24);