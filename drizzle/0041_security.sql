CREATE TYPE "public"."login_step" AS ENUM('VERIFY', 'ENROL');--> statement-breakpoint
CREATE TYPE "public"."net_connection" AS ENUM('NONE', 'WIRED', 'WIRELESS', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."remote_access" AS ENUM('NONE', 'SUPPLIER', 'HOSPITAL', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."tri_state" AS ENUM('YES', 'NO', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE "asset_security" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"connection" "net_connection" DEFAULT 'NONE' NOT NULL,
	"ip_address" varchar(45),
	"mac_address" varchar(17),
	"hostname" varchar(120),
	"network_zone" varchar(80),
	"operating_system" varchar(120),
	"os_support_ends" date,
	"stores_patient_data" "tri_state" DEFAULT 'UNKNOWN' NOT NULL,
	"sends_patient_data" "tri_state" DEFAULT 'UNKNOWN' NOT NULL,
	"encrypted" "tri_state" DEFAULT 'UNKNOWN' NOT NULL,
	"anti_malware" "tri_state" DEFAULT 'UNKNOWN' NOT NULL,
	"default_passwords_changed" "tri_state" DEFAULT 'UNKNOWN' NOT NULL,
	"remote_access" "remote_access" DEFAULT 'NONE' NOT NULL,
	"last_patched_on" date,
	"mds2_on_file" boolean DEFAULT false NOT NULL,
	"mds2_ref" text,
	"reviewed_on" date,
	"reviewed_by_name" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_security_asset_id_unique" UNIQUE("asset_id")
);
--> statement-breakpoint
CREATE TABLE "login_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"user_id" integer NOT NULL,
	"step" "login_step" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_challenges_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_last_step" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "backup_code_hashes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_security" ADD CONSTRAINT "asset_security_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_challenges" ADD CONSTRAINT "login_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;