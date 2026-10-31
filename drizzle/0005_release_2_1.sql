CREATE TYPE "public"."approval_entity" AS ENUM('PO', 'BOQ', 'AWARD');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."approval_step_status" AS ENUM('WAITING', 'PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."committee_capacity" AS ENUM('CHAIR', 'TECHNICAL', 'FINANCIAL', 'LEGAL', 'MOF_REP', 'STATE_COUNCIL_REP', 'HOUSING_REP', 'SECRETARY', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."committee_kind" AS ENUM('OPENING', 'ADJUDICATION', 'COMBINED');--> statement-breakpoint
ALTER TYPE "public"."po_status" ADD VALUE 'PENDING_APPROVAL';--> statement-breakpoint
ALTER TYPE "public"."po_status" ADD VALUE 'APPROVED';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'PLANNER';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'TECHNICIAN';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'DIRECTOR';--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" "approval_entity" NOT NULL,
	"label" text NOT NULL,
	"approver_role" "user_role" NOT NULL,
	"min_amount_egp" numeric(14, 2) DEFAULT '0' NOT NULL,
	"max_amount_egp" numeric(14, 2),
	"step_order" integer DEFAULT 1 NOT NULL,
	"facility_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" "approval_entity" NOT NULL,
	"entity_id" integer NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"title" text NOT NULL,
	"href" text NOT NULL,
	"amount_egp" numeric(14, 2),
	"facility_id" integer,
	"requested_by_id" integer,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "approval_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"step_order" integer NOT NULL,
	"label" text NOT NULL,
	"approver_role" "user_role",
	"approver_user_id" integer,
	"member_name" text,
	"status" "approval_step_status" DEFAULT 'WAITING' NOT NULL,
	"decided_by_id" integer,
	"decided_at" timestamp with time zone,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "committee_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"committee_id" integer NOT NULL,
	"user_id" integer,
	"name" text NOT NULL,
	"capacity" "committee_capacity" DEFAULT 'MEMBER' NOT NULL,
	"votes" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committees" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"kind" "committee_kind" NOT NULL,
	"decision_ref" text,
	"formed_on" date,
	"due_by" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_sequences" (
	"prefix" varchar(16) NOT NULL,
	"year" integer NOT NULL,
	"last" integer NOT NULL,
	CONSTRAINT "doc_sequences_prefix_year_pk" PRIMARY KEY("prefix","year")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" varchar(48) NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"dedupe_key" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_facilities" (
	"user_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	CONSTRAINT "user_facilities_user_id_facility_id_pk" PRIMARY KEY("user_id","facility_id")
);
--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "award_approved_on" date;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "complaint_until" date;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "acceptance_due" date;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "accepted_on" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" varchar(32);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "all_facilities" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_members" ADD CONSTRAINT "committee_members_committee_id_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_members" ADD CONSTRAINT "committee_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committees" ADD CONSTRAINT "committees_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_facilities" ADD CONSTRAINT "user_facilities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_facilities" ADD CONSTRAINT "user_facilities_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_entity_idx" ON "approval_requests" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "approval_steps_request_idx" ON "approval_steps" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "committee_members_committee_idx" ON "committee_members" USING btree ("committee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "committees_project_kind_uq" ON "committees" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");