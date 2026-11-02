CREATE TABLE "room_kits" (
	"id" serial PRIMARY KEY NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"match" text,
	"room_type" "room_type",
	"finish" varchar(16) NOT NULL,
	"items" jsonb NOT NULL,
	"updated_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
