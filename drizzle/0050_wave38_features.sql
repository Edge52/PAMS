CREATE TABLE "asset_ae_titles" (
	"ae_title" varchar(16) PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_ae_titles_upper_check" CHECK ("asset_ae_titles"."ae_title" = upper("asset_ae_titles"."ae_title"))
);
--> statement-breakpoint
CREATE TABLE "contract_coverage" (
	"contract_id" integer PRIMARY KEY NOT NULL,
	"all_hours" boolean DEFAULT false NOT NULL,
	"days" smallint[] DEFAULT '{0,1,2,3,4}'::smallint[] NOT NULL,
	"from_time" varchar(5) DEFAULT '08:00' NOT NULL,
	"to_time" varchar(5) DEFAULT '20:00' NOT NULL,
	"exclude_holidays" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_coverage_from_check" CHECK ("contract_coverage"."from_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "contract_coverage_to_check" CHECK ("contract_coverage"."to_time" ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$')
);
--> statement-breakpoint
CREATE TABLE "cryogen_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"read_on" date NOT NULL,
	"helium_pct" real NOT NULL,
	"pressure_psi" real,
	"cold_head" varchar(12),
	"compressor" varchar(12),
	"chiller_temp_c" real,
	"remarks" text,
	"read_by" text NOT NULL,
	"recorded_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cryogen_readings_helium_check" CHECK ("cryogen_readings"."helium_pct" between 0 and 100),
	CONSTRAINT "cryogen_readings_pressure_check" CHECK ("cryogen_readings"."pressure_psi" is null or "cryogen_readings"."pressure_psi" between -15 and 100),
	CONSTRAINT "cryogen_readings_chiller_check" CHECK ("cryogen_readings"."chiller_temp_c" is null or "cryogen_readings"."chiller_temp_c" between -20 and 60)
);
--> statement-breakpoint
CREATE TABLE "exam_counts" (
	"asset_id" integer NOT NULL,
	"day" date NOT NULL,
	"procedure" text DEFAULT '' NOT NULL,
	"modality" varchar(16),
	"exams" integer NOT NULL,
	"source" text,
	"imported_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_counts_asset_id_day_procedure_pk" PRIMARY KEY("asset_id","day","procedure"),
	CONSTRAINT "exam_counts_exams_check" CHECK ("exam_counts"."exams" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "mri_magnets" (
	"asset_id" integer PRIMARY KEY NOT NULL,
	"cryogenic" boolean DEFAULT true NOT NULL,
	"helium_min_pct" real DEFAULT 70 NOT NULL,
	"max_drop_pct" real DEFAULT 2 NOT NULL,
	"drop_window_days" integer DEFAULT 30 NOT NULL,
	"max_gap_days" integer DEFAULT 7 NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mri_magnets_min_check" CHECK ("mri_magnets"."helium_min_pct" between 0 and 100),
	CONSTRAINT "mri_magnets_drop_check" CHECK ("mri_magnets"."max_drop_pct" > 0 and "mri_magnets"."max_drop_pct" <= 100),
	CONSTRAINT "mri_magnets_window_check" CHECK ("mri_magnets"."drop_window_days" between 1 and 365),
	CONSTRAINT "mri_magnets_gap_check" CHECK ("mri_magnets"."max_gap_days" between 1 and 90)
);
--> statement-breakpoint
CREATE TABLE "public_holidays" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"day" date NOT NULL,
	"name" text NOT NULL,
	"approximate" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tube_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tube_id" integer NOT NULL,
	"read_on" date NOT NULL,
	"counter" double precision NOT NULL,
	"note" text,
	"read_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tube_readings_counter_check" CHECK ("tube_readings"."counter" >= 0)
);
--> statement-breakpoint
CREATE TABLE "xray_tubes" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"serial_number" text NOT NULL,
	"maker" text,
	"model" text,
	"counter_unit" varchar(16) NOT NULL,
	"installed_on" date NOT NULL,
	"counter_at_install" double precision DEFAULT 0 NOT NULL,
	"warranty_months" integer,
	"warranty_counter" double precision,
	"expected_life" double precision,
	"cost" numeric(14, 2),
	"currency" varchar(3),
	"under_warranty" boolean DEFAULT false NOT NULL,
	"removed_on" date,
	"removed_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xray_tubes_dates_check" CHECK ("xray_tubes"."removed_on" is null or "xray_tubes"."removed_on" >= "xray_tubes"."installed_on"),
	CONSTRAINT "xray_tubes_counter_check" CHECK ("xray_tubes"."counter_at_install" >= 0),
	CONSTRAINT "xray_tubes_warranty_check" CHECK (("xray_tubes"."warranty_months" is null or "xray_tubes"."warranty_months" between 1 and 240) and ("xray_tubes"."warranty_counter" is null or "xray_tubes"."warranty_counter" > 0)),
	CONSTRAINT "xray_tubes_life_check" CHECK ("xray_tubes"."expected_life" is null or "xray_tubes"."expected_life" > 0),
	CONSTRAINT "xray_tubes_cost_check" CHECK ("xray_tubes"."cost" is null or "xray_tubes"."cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "committee_member_legal_names" (
	"member_id" integer PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_legal_names" (
	"supplier_id" integer PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_ae_titles" ADD CONSTRAINT "asset_ae_titles_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_coverage" ADD CONSTRAINT "contract_coverage_contract_id_service_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."service_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cryogen_readings" ADD CONSTRAINT "cryogen_readings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cryogen_readings" ADD CONSTRAINT "cryogen_readings_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cryogen_readings" ADD CONSTRAINT "cryogen_readings_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_counts" ADD CONSTRAINT "exam_counts_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mri_magnets" ADD CONSTRAINT "mri_magnets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tube_readings" ADD CONSTRAINT "tube_readings_tube_id_xray_tubes_id_fk" FOREIGN KEY ("tube_id") REFERENCES "public"."xray_tubes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_tubes" ADD CONSTRAINT "xray_tubes_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_tubes" ADD CONSTRAINT "xray_tubes_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_member_legal_names" ADD CONSTRAINT "committee_member_legal_names_member_id_committee_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."committee_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_legal_names" ADD CONSTRAINT "supplier_legal_names_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_ae_titles_asset_idx" ON "asset_ae_titles" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "cryogen_readings_asset_idx" ON "cryogen_readings" USING btree ("asset_id","read_on");--> statement-breakpoint
CREATE INDEX "cryogen_readings_facility_idx" ON "cryogen_readings" USING btree ("facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_holidays_facility_day_uq" ON "public_holidays" USING btree ("facility_id","day");--> statement-breakpoint
CREATE INDEX "tube_readings_tube_idx" ON "tube_readings" USING btree ("tube_id","read_on");--> statement-breakpoint
CREATE INDEX "xray_tubes_asset_idx" ON "xray_tubes" USING btree ("asset_id","installed_on");--> statement-breakpoint
CREATE INDEX "xray_tubes_facility_idx" ON "xray_tubes" USING btree ("facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "xray_tubes_one_in_use_uq" ON "xray_tubes" USING btree ("asset_id") WHERE "xray_tubes"."removed_on" is null;