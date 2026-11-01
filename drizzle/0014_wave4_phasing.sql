ALTER TABLE "boq_departments" ADD COLUMN "phase" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "boqs" ADD COLUMN "opening_date" date;--> statement-breakpoint
ALTER TABLE "boqs" ADD COLUMN "phase_months" jsonb DEFAULT '[0,6,12,18]'::jsonb NOT NULL;