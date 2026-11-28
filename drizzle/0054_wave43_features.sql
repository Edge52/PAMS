CREATE TABLE "dose_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"exam_date" date NOT NULL,
	"modality" varchar(8) NOT NULL,
	"exam_type" text NOT NULL,
	"protocol" text,
	"age_group" varchar(10) DEFAULT 'ADULT' NOT NULL,
	"ctdivol" double precision,
	"dlp" double precision,
	"dap" double precision,
	"esd" double precision,
	"fluoro_time" double precision,
	"agd" double precision,
	"source" varchar(8) DEFAULT 'ENTERED' NOT NULL,
	"import_file" text,
	"entered_by_id" integer,
	"entered_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dose_records_values_check" CHECK (coalesce("dose_records"."ctdivol", 0) >= 0 and coalesce("dose_records"."dlp", 0) >= 0 and coalesce("dose_records"."dap", 0) >= 0 and coalesce("dose_records"."esd", 0) >= 0 and coalesce("dose_records"."fluoro_time", 0) >= 0 and coalesce("dose_records"."agd", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "dose_reference_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"modality" varchar(8) NOT NULL,
	"exam_type" text NOT NULL,
	"age_group" varchar(10) DEFAULT 'ADULT' NOT NULL,
	"quantity" varchar(8) NOT NULL,
	"value" double precision NOT NULL,
	"source" text NOT NULL,
	"source_year" integer,
	"is_example" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dose_reference_levels_value_check" CHECK ("dose_reference_levels"."value" > 0),
	CONSTRAINT "dose_reference_levels_year_check" CHECK ("dose_reference_levels"."source_year" is null or "dose_reference_levels"."source_year" between 1990 and 2100)
);
--> statement-breakpoint
CREATE TABLE "dose_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"modality" varchar(8) NOT NULL,
	"exam_key" text NOT NULL,
	"exam_type" text NOT NULL,
	"age_group" varchar(10) NOT NULL,
	"month" varchar(7) NOT NULL,
	"figures" text,
	"findings" text NOT NULL,
	"action" text NOT NULL,
	"reviewed_on" date NOT NULL,
	"reviewed_by_id" integer,
	"reviewed_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer,
	"day" date NOT NULL,
	"name" text NOT NULL,
	"moves" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holidays_facility_day_uq" UNIQUE NULLS NOT DISTINCT("facility_id","day")
);
--> statement-breakpoint
ALTER TABLE "dose_records" ADD CONSTRAINT "dose_records_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_records" ADD CONSTRAINT "dose_records_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_records" ADD CONSTRAINT "dose_records_entered_by_id_users_id_fk" FOREIGN KEY ("entered_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_reference_levels" ADD CONSTRAINT "dose_reference_levels_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_reviews" ADD CONSTRAINT "dose_reviews_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_reviews" ADD CONSTRAINT "dose_reviews_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_reviews" ADD CONSTRAINT "dose_reviews_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dose_records_asset_idx" ON "dose_records" USING btree ("asset_id","exam_date");--> statement-breakpoint
CREATE INDEX "dose_records_facility_idx" ON "dose_records" USING btree ("facility_id","exam_date");--> statement-breakpoint
CREATE UNIQUE INDEX "dose_reference_levels_uq" ON "dose_reference_levels" USING btree ("facility_id","modality",lower("exam_type"),"age_group","quantity");--> statement-breakpoint
CREATE UNIQUE INDEX "dose_reviews_uq" ON "dose_reviews" USING btree ("asset_id","modality","exam_key","age_group","month");--> statement-breakpoint
CREATE INDEX "dose_reviews_facility_idx" ON "dose_reviews" USING btree ("facility_id","month");--> statement-breakpoint
CREATE INDEX "holidays_day_idx" ON "holidays" USING btree ("day");