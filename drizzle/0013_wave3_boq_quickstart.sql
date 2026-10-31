CREATE TYPE "public"."price_tier" AS ENUM('BASIC', 'STANDARD', 'PREMIUM');--> statement-breakpoint
CREATE TABLE "device_companions" (
	"device_type_id" integer NOT NULL,
	"companion_type_id" integer NOT NULL,
	"ratio" double precision DEFAULT 1 NOT NULL,
	"note" text,
	CONSTRAINT "device_companions_device_type_id_companion_type_id_pk" PRIMARY KEY("device_type_id","companion_type_id")
);
--> statement-breakpoint
DROP INDEX "boq_rules_uq";--> statement-breakpoint
ALTER TABLE "boq_departments" ADD COLUMN "params" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "boq_departments" ADD COLUMN "price_tier" "price_tier";--> statement-breakpoint
ALTER TABLE "boq_lines" ADD COLUMN "price_tier" "price_tier";--> statement-breakpoint
ALTER TABLE "boq_lines" ADD COLUMN "price_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "boq_rules" ADD COLUMN "param" varchar(32);--> statement-breakpoint
ALTER TABLE "boq_rules" ADD COLUMN "param_ratio" double precision;--> statement-breakpoint
ALTER TABLE "boq_rules" ADD COLUMN "condition" varchar(32) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "boqs" ADD COLUMN "features" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "boqs" ADD COLUMN "price_tier" "price_tier" DEFAULT 'STANDARD' NOT NULL;--> statement-breakpoint
ALTER TABLE "boqs" ADD COLUMN "target_budget" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "device_companions" ADD CONSTRAINT "device_companions_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_companions" ADD CONSTRAINT "device_companions_companion_type_id_device_types_id_fk" FOREIGN KEY ("companion_type_id") REFERENCES "public"."device_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boq_rules_uq" ON "boq_rules" USING btree ("standard_set_id","department_type_code","device_type_id","condition");