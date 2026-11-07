CREATE TABLE "assistant_chats" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"turns" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commissioning_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"project_id" integer,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"install_weeks" integer DEFAULT 2 NOT NULL,
	"accept_weeks" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commissioning_rooms" (
	"plan_id" integer NOT NULL,
	"room_id" integer NOT NULL,
	"handover_planned" date,
	"install_planned" date,
	"accept_planned" date,
	"handover_on" date,
	"no_equipment" boolean DEFAULT false NOT NULL,
	"note" text,
	CONSTRAINT "commissioning_rooms_plan_id_room_id_pk" PRIMARY KEY("plan_id","room_id")
);
--> statement-breakpoint
CREATE TABLE "room_standards" (
	"id" serial PRIMARY KEY NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"match" text,
	"room_type" "room_type",
	"spec" jsonb NOT NULL,
	"source" text,
	"updated_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_chats" ADD CONSTRAINT "assistant_chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissioning_plans" ADD CONSTRAINT "commissioning_plans_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissioning_plans" ADD CONSTRAINT "commissioning_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissioning_rooms" ADD CONSTRAINT "commissioning_rooms_plan_id_commissioning_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."commissioning_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissioning_rooms" ADD CONSTRAINT "commissioning_rooms_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_chats_user_idx" ON "assistant_chats" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "commissioning_plans_facility_idx" ON "commissioning_plans" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "commissioning_rooms_room_idx" ON "commissioning_rooms" USING btree ("room_id");