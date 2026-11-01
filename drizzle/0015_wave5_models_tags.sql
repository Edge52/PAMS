CREATE TABLE "device_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_type_id" integer NOT NULL,
	"manufacturer" text NOT NULL,
	"model" text NOT NULL,
	"ref_price_usd" numeric(14, 2),
	"end_of_sale" date,
	"end_of_support" date,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preferred_models" (
	"facility_id" integer NOT NULL,
	"device_type_id" integer NOT NULL,
	"model_id" integer NOT NULL,
	"reason" text,
	"set_by" text,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preferred_models_facility_id_device_type_id_pk" PRIMARY KEY("facility_id","device_type_id")
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "device_models" ADD CONSTRAINT "device_models_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferred_models" ADD CONSTRAINT "preferred_models_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferred_models" ADD CONSTRAINT "preferred_models_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferred_models" ADD CONSTRAINT "preferred_models_model_id_device_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."device_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_models_unique" ON "device_models" USING btree ("device_type_id",lower("manufacturer"),lower("model"));--> statement-breakpoint
CREATE INDEX "device_models_type_idx" ON "device_models" USING btree ("device_type_id");