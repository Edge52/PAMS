CREATE TABLE "backup_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"ok" boolean NOT NULL,
	"detail" text NOT NULL,
	"by_name" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acceptances" DROP CONSTRAINT "acceptances_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "asset_movements" DROP CONSTRAINT "asset_movements_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "asset_status_days" DROP CONSTRAINT "asset_status_days_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "disposals" DROP CONSTRAINT "disposals_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "imaging_usage" DROP CONSTRAINT "imaging_usage_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "maintenance_events" DROP CONSTRAINT "maintenance_events_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "recall_assets" DROP CONSTRAINT "recall_assets_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "round_items" DROP CONSTRAINT "round_items_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "service_contract_assets" DROP CONSTRAINT "service_contract_assets_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "actor_id" integer;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "ip" varchar(64);--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "changes" jsonb;--> statement-breakpoint
ALTER TABLE "approval_policies" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "udi_di" varchar(32);--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "udi_pi" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "software_version" text;--> statement-breakpoint
ALTER TABLE "bonds" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "committees" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "device_models" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "device_types" ADD COLUMN "gmdn_code" varchar(8);--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rfqs" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "route_fixes" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sim_scenarios" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "standard_sets" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "tech_specs" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "twin_notes" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "twin_views" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "backup_checks_at_idx" ON "backup_checks" USING btree ("at");--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_status_days" ADD CONSTRAINT "asset_status_days_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposals" ADD CONSTRAINT "disposals_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_usage" ADD CONSTRAINT "imaging_usage_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_events_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_assets" ADD CONSTRAINT "recall_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_items" ADD CONSTRAINT "round_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_contract_assets" ADD CONSTRAINT "service_contract_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_at_idx" ON "activity_log" USING btree ("at");--> statement-breakpoint
ALTER TABLE "frameworks" ADD CONSTRAINT "frameworks_dates_check" CHECK ("frameworks"."end_date" >= "frameworks"."start_date");--> statement-breakpoint
ALTER TABLE "frameworks" ADD CONSTRAINT "frameworks_ceiling_check" CHECK ("frameworks"."ceiling" >= 0);--> statement-breakpoint
ALTER TABLE "offer_lines" ADD CONSTRAINT "offer_lines_quantity_check" CHECK ("offer_lines"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "offer_lines" ADD CONSTRAINT "offer_lines_price_check" CHECK ("offer_lines"."unit_price" >= 0);--> statement-breakpoint
ALTER TABLE "offer_lines" ADD CONSTRAINT "offer_lines_discount_check" CHECK ("offer_lines"."discount_pct" >= 0 and "offer_lines"."discount_pct" <= 100);--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_quantity_check" CHECK ("po_lines"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_price_check" CHECK ("po_lines"."unit_price" >= 0);--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_received_check" CHECK ("po_lines"."received_qty" >= 0);--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_dates_check" CHECK ("service_contracts"."end_date" >= "service_contracts"."start_date");--> statement-breakpoint
-- Wave 24: the activity log is a record. Entries can be added, never changed or removed.
-- (The one change allowed is the database clearing actor_id when that user's account is deleted.)
CREATE OR REPLACE FUNCTION activity_log_is_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.actor_id IS NULL AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'The activity log can''t be changed or deleted (it is the audit trail).';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS activity_log_append_only ON "activity_log";--> statement-breakpoint
CREATE TRIGGER activity_log_append_only BEFORE UPDATE OR DELETE ON "activity_log" FOR EACH ROW EXECUTE FUNCTION activity_log_is_append_only();
