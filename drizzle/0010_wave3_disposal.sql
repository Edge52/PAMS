CREATE TYPE "public"."disposal_method" AS ENUM('SCRAP', 'SALE', 'DONATION', 'RETURN_TO_SUPPLIER', 'TRADE_IN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."disposal_reason" AS ENUM('BEYOND_REPAIR', 'END_OF_LIFE', 'OBSOLETE', 'UNSAFE', 'RECALLED', 'LOST_OR_STOLEN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."disposal_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."approval_entity" ADD VALUE 'DISPOSAL';--> statement-breakpoint
CREATE TABLE "disposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" varchar(24) NOT NULL,
	"asset_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"reason" "disposal_reason" NOT NULL,
	"method" "disposal_method" DEFAULT 'SCRAP' NOT NULL,
	"justification" text NOT NULL,
	"estimated_value" numeric(14, 2),
	"currency" varchar(3),
	"status" "disposal_status" DEFAULT 'DRAFT' NOT NULL,
	"requested_by_id" integer,
	"requested_by_name" text,
	"decided_at" timestamp with time zone,
	"disposed_on" date,
	"proceeds" numeric(14, 2),
	"certificate_ref" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disposals_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "disposals" ADD CONSTRAINT "disposals_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposals" ADD CONSTRAINT "disposals_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposals" ADD CONSTRAINT "disposals_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disposals_asset_idx" ON "disposals" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "disposals_facility_idx" ON "disposals" USING btree ("facility_id");