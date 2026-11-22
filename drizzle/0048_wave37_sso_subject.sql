ALTER TABLE "users" ADD COLUMN "sso_subject" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_sso_subject_unique" UNIQUE("sso_subject");