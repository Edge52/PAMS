ALTER TABLE "assets" ADD COLUMN "residual_pct" real;--> statement-breakpoint
ALTER TABLE "device_types" ADD COLUMN "residual_pct" real;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "expires_on" date;--> statement-breakpoint
CREATE INDEX "documents_expires_idx" ON "documents" USING btree ("expires_on");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_residual_check" CHECK ("assets"."residual_pct" is null or ("assets"."residual_pct" >= 0 and "assets"."residual_pct" <= 100));--> statement-breakpoint
ALTER TABLE "device_types" ADD CONSTRAINT "device_types_residual_check" CHECK ("device_types"."residual_pct" is null or ("device_types"."residual_pct" >= 0 and "device_types"."residual_pct" <= 100));