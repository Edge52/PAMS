CREATE TABLE "floor_cad" (
	"floor_id" integer PRIMARY KEY NOT NULL,
	"source_file" text,
	"walls" jsonb NOT NULL,
	"doors" jsonb,
	"glass" jsonb,
	"columns" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "floors" ADD COLUMN "elevation" real;--> statement-breakpoint
ALTER TABLE "floors" ADD COLUMN "units_per_metre" real;--> statement-breakpoint
ALTER TABLE "floor_cad" ADD CONSTRAINT "floor_cad_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE cascade ON UPDATE no action;