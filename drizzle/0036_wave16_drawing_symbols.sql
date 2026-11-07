CREATE TABLE "drawing_symbols" (
	"id" serial PRIMARY KEY NOT NULL,
	"floor_id" integer NOT NULL,
	"room_id" integer,
	"kind" varchar(16) NOT NULL,
	"code" varchar(32),
	"label" text NOT NULL,
	"block" text,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"rot" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "floor_cad" ADD COLUMN "drawing" jsonb;--> statement-breakpoint
ALTER TABLE "drawing_symbols" ADD CONSTRAINT "drawing_symbols_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawing_symbols" ADD CONSTRAINT "drawing_symbols_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drawing_symbols_floor_idx" ON "drawing_symbols" USING btree ("floor_id");--> statement-breakpoint
CREATE INDEX "drawing_symbols_room_idx" ON "drawing_symbols" USING btree ("room_id");