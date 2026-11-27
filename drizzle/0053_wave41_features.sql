CREATE TABLE "approval_delegations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"deputy_id" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reason" text,
	"set_by_id" integer,
	"set_by_name" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_delegations_dates_check" CHECK ("approval_delegations"."ends_on" >= "approval_delegations"."starts_on"),
	CONSTRAINT "approval_delegations_self_check" CHECK ("approval_delegations"."deputy_id" <> "approval_delegations"."user_id")
);
--> statement-breakpoint
CREATE TABLE "approval_step_tracking" (
	"step_id" integer PRIMARY KEY NOT NULL,
	"pending_since" timestamp with time zone DEFAULT now() NOT NULL,
	"level" smallint DEFAULT 0 NOT NULL,
	"reminded_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"decided_for_id" integer,
	"decided_for_name" text
);
--> statement-breakpoint
CREATE TABLE "biomed_on_call" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"set_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "biomed_on_call_times_check" CHECK ("biomed_on_call"."ends_at" > "biomed_on_call"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "notification_digests" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"hour" smallint DEFAULT 7 NOT NULL,
	"last_sent_on" date,
	"last_sent_at" timestamp with time zone,
	CONSTRAINT "notification_digests_hour_check" CHECK ("notification_digests"."hour" between 0 and 23)
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"user_id" integer NOT NULL,
	"kind" varchar(48) NOT NULL,
	"channel" varchar(8) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_prefs_user_id_kind_pk" PRIMARY KEY("user_id","kind")
);
--> statement-breakpoint
CREATE TABLE "work_order_escalations" (
	"work_order_id" integer PRIMARY KEY NOT NULL,
	"level" smallint DEFAULT 0 NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_id" integer,
	"path" text NOT NULL,
	"status" smallint NOT NULL,
	"rows" integer,
	"ip" varchar(64),
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"prefix" varchar(16) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"facility_ids" integer[],
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_by_id" integer,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "model_software_components" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_model_id" integer NOT NULL,
	"name" text NOT NULL,
	"version" varchar(64),
	"supplier" text,
	"support_ends" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_risks" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"connects_to" text NOT NULL,
	"data_exchanged" text,
	"hazard" text NOT NULL,
	"likelihood" smallint NOT NULL,
	"severity" smallint NOT NULL,
	"controls" text,
	"residual_likelihood" smallint NOT NULL,
	"residual_severity" smallint NOT NULL,
	"owner" text,
	"review_due" date,
	"status" varchar(12) DEFAULT 'OPEN' NOT NULL,
	"recorded_by_id" integer,
	"recorded_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "network_risks_scores_check" CHECK ("network_risks"."likelihood" between 1 and 5 and "network_risks"."severity" between 1 and 5 and "network_risks"."residual_likelihood" between 1 and 5 and "network_risks"."residual_severity" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "utility_systems" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"kind" varchar(24) NOT NULL,
	"serves" text,
	"critical" boolean DEFAULT true NOT NULL,
	"rated_kw" real,
	"required_minutes" real,
	"min_fuel_pct" real,
	"temp_low" real,
	"temp_high" real,
	"required_ach" real,
	"pressure" varchar(8),
	"min_pressure_pa" real,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "utility_systems_figures_check" CHECK (("utility_systems"."rated_kw" is null or "utility_systems"."rated_kw" > 0) and ("utility_systems"."required_minutes" is null or "utility_systems"."required_minutes" >= 0)
    and ("utility_systems"."min_fuel_pct" is null or "utility_systems"."min_fuel_pct" between 0 and 100) and ("utility_systems"."required_ach" is null or "utility_systems"."required_ach" >= 0)
    and ("utility_systems"."min_pressure_pa" is null or "utility_systems"."min_pressure_pa" >= 0) and ("utility_systems"."temp_low" is null or "utility_systems"."temp_high" is null or "utility_systems"."temp_high" > "utility_systems"."temp_low"))
);
--> statement-breakpoint
CREATE TABLE "utility_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"system_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"kind" varchar(24) NOT NULL,
	"tested_on" date NOT NULL,
	"load_kw" real,
	"duration_min" real,
	"transfer_sec" real,
	"fuel_pct" real,
	"autonomy_min" real,
	"temp_min" real,
	"temp_max" real,
	"excursion_min" real,
	"air_changes" real,
	"pressure_pa" real,
	"checks_ok" boolean,
	"passed" boolean NOT NULL,
	"problems" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"work_order_id" integer,
	"by_id" integer,
	"by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "utility_tests_readings_check" CHECK (("utility_tests"."load_kw" is null or "utility_tests"."load_kw" >= 0) and ("utility_tests"."duration_min" is null or "utility_tests"."duration_min" >= 0)
    and ("utility_tests"."transfer_sec" is null or "utility_tests"."transfer_sec" >= 0) and ("utility_tests"."fuel_pct" is null or "utility_tests"."fuel_pct" between 0 and 100)
    and ("utility_tests"."autonomy_min" is null or "utility_tests"."autonomy_min" >= 0) and ("utility_tests"."excursion_min" is null or "utility_tests"."excursion_min" >= 0)
    and ("utility_tests"."air_changes" is null or "utility_tests"."air_changes" >= 0))
);
--> statement-breakpoint
CREATE TABLE "water_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" varchar(24) NOT NULL,
	"asset_id" integer,
	"room_id" integer,
	"every_days" integer DEFAULT 30 NOT NULL,
	"tvc_action" real,
	"tvc_limit" real,
	"endotoxin_action" real,
	"endotoxin_limit" real,
	"chlorine_max" real,
	"free_chlorine_min" real,
	"conductivity_max" real,
	"coliform_max" real,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "water_points_limits_check" CHECK ("water_points"."every_days" between 1 and 730
    and ("water_points"."tvc_action" is null or "water_points"."tvc_action" >= 0) and ("water_points"."tvc_limit" is null or "water_points"."tvc_limit" >= 0)
    and ("water_points"."endotoxin_action" is null or "water_points"."endotoxin_action" >= 0) and ("water_points"."endotoxin_limit" is null or "water_points"."endotoxin_limit" >= 0)
    and ("water_points"."chlorine_max" is null or "water_points"."chlorine_max" >= 0) and ("water_points"."free_chlorine_min" is null or "water_points"."free_chlorine_min" >= 0)
    and ("water_points"."conductivity_max" is null or "water_points"."conductivity_max" >= 0) and ("water_points"."coliform_max" is null or "water_points"."coliform_max" >= 0))
);
--> statement-breakpoint
CREATE TABLE "water_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"point_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"sampled_on" date NOT NULL,
	"tvc" real,
	"endotoxin" real,
	"chlorine" real,
	"free_chlorine" real,
	"conductivity" real,
	"coliforms" real,
	"chemistry_ok" boolean,
	"lab" text,
	"level" varchar(8) NOT NULL,
	"problems" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"work_order_id" integer,
	"by_id" integer,
	"by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "water_samples_values_check" CHECK (("water_samples"."tvc" is null or "water_samples"."tvc" >= 0) and ("water_samples"."endotoxin" is null or "water_samples"."endotoxin" >= 0)
    and ("water_samples"."chlorine" is null or "water_samples"."chlorine" >= 0) and ("water_samples"."free_chlorine" is null or "water_samples"."free_chlorine" >= 0)
    and ("water_samples"."conductivity" is null or "water_samples"."conductivity" >= 0) and ("water_samples"."coliforms" is null or "water_samples"."coliforms" >= 0))
);
--> statement-breakpoint
CREATE TABLE "saved_filters" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"page" text NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"shared_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_deputy_id_users_id_fk" FOREIGN KEY ("deputy_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_set_by_id_users_id_fk" FOREIGN KEY ("set_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_step_tracking" ADD CONSTRAINT "approval_step_tracking_step_id_approval_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."approval_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_step_tracking" ADD CONSTRAINT "approval_step_tracking_decided_for_id_users_id_fk" FOREIGN KEY ("decided_for_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biomed_on_call" ADD CONSTRAINT "biomed_on_call_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biomed_on_call" ADD CONSTRAINT "biomed_on_call_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_digests" ADD CONSTRAINT "notification_digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_escalations" ADD CONSTRAINT "work_order_escalations_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_calls" ADD CONSTRAINT "api_calls_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_software_components" ADD CONSTRAINT "model_software_components_device_model_id_device_models_id_fk" FOREIGN KEY ("device_model_id") REFERENCES "public"."device_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_risks" ADD CONSTRAINT "network_risks_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_risks" ADD CONSTRAINT "network_risks_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_risks" ADD CONSTRAINT "network_risks_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_systems" ADD CONSTRAINT "utility_systems_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_systems" ADD CONSTRAINT "utility_systems_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_tests" ADD CONSTRAINT "utility_tests_system_id_utility_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."utility_systems"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_tests" ADD CONSTRAINT "utility_tests_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_tests" ADD CONSTRAINT "utility_tests_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_tests" ADD CONSTRAINT "utility_tests_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_tests" ADD CONSTRAINT "utility_tests_by_id_users_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_points" ADD CONSTRAINT "water_points_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_points" ADD CONSTRAINT "water_points_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_points" ADD CONSTRAINT "water_points_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_samples" ADD CONSTRAINT "water_samples_point_id_water_points_id_fk" FOREIGN KEY ("point_id") REFERENCES "public"."water_points"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_samples" ADD CONSTRAINT "water_samples_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_samples" ADD CONSTRAINT "water_samples_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_samples" ADD CONSTRAINT "water_samples_by_id_users_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_delegations_user_idx" ON "approval_delegations" USING btree ("user_id","ends_on");--> statement-breakpoint
CREATE INDEX "approval_delegations_deputy_idx" ON "approval_delegations" USING btree ("deputy_id","ends_on");--> statement-breakpoint
CREATE INDEX "biomed_on_call_facility_idx" ON "biomed_on_call" USING btree ("facility_id","ends_at");--> statement-breakpoint
CREATE INDEX "api_calls_token_at_idx" ON "api_calls" USING btree ("token_id","at");--> statement-breakpoint
CREATE INDEX "model_software_components_model_idx" ON "model_software_components" USING btree ("device_model_id");--> statement-breakpoint
CREATE INDEX "network_risks_asset_idx" ON "network_risks" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "network_risks_facility_idx" ON "network_risks" USING btree ("facility_id","review_due");--> statement-breakpoint
CREATE UNIQUE INDEX "utility_systems_asset_uq" ON "utility_systems" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "utility_systems_facility_idx" ON "utility_systems" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "utility_tests_system_idx" ON "utility_tests" USING btree ("system_id","kind","tested_on");--> statement-breakpoint
CREATE INDEX "utility_tests_facility_idx" ON "utility_tests" USING btree ("facility_id","tested_on");--> statement-breakpoint
CREATE INDEX "water_points_facility_idx" ON "water_points" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "water_samples_point_idx" ON "water_samples" USING btree ("point_id","sampled_on");--> statement-breakpoint
CREATE INDEX "water_samples_facility_idx" ON "water_samples" USING btree ("facility_id","sampled_on");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_filters_user_page_name_uq" ON "saved_filters" USING btree ("user_id","page","name");--> statement-breakpoint
CREATE INDEX "saved_filters_page_role_idx" ON "saved_filters" USING btree ("page","shared_role");