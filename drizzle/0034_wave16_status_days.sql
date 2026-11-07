CREATE TABLE "asset_status_days" (
	"asset_id" integer NOT NULL,
	"day" date NOT NULL,
	"status" "asset_status" NOT NULL,
	"source" varchar(16) DEFAULT 'snapshot' NOT NULL,
	CONSTRAINT "asset_status_days_asset_id_day_pk" PRIMARY KEY("asset_id","day")
);
--> statement-breakpoint
ALTER TABLE "asset_status_days" ADD CONSTRAINT "asset_status_days_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_status_days_day_idx" ON "asset_status_days" USING btree ("day");