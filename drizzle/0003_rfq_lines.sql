CREATE TABLE "rfq_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfq_id" integer NOT NULL,
	"device_type_id" integer NOT NULL,
	"quantity" integer,
	"boq_line_ids" integer[] DEFAULT '{}'::int[] NOT NULL,
	"departments" text[] DEFAULT '{}'::text[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_lines_uq" ON "rfq_lines" USING btree ("rfq_id","device_type_id");