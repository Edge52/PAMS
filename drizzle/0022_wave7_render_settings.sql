ALTER TABLE "facilities" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "brand_color" varchar(7);--> statement-breakpoint
ALTER TABLE "twin_views" ADD COLUMN "render" jsonb;