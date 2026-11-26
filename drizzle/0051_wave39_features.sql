CREATE TABLE "po_penalty_terms" (
	"po_id" integer PRIMARY KEY NOT NULL,
	"contract_type" varchar(16),
	"blocks_use" boolean DEFAULT false NOT NULL,
	"waived_reason" text,
	"waived_by_name" text,
	"waived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "po_penalty_terms_type_check" CHECK ("po_penalty_terms"."contract_type" is null or "po_penalty_terms"."contract_type" in ('SUPPLY', 'SERVICES', 'WORKS'))
);
--> statement-breakpoint
CREATE TABLE "project_law_terms" (
	"project_id" integer PRIMARY KEY NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"urgent_reason" text,
	"bid_bond_amount" numeric(14, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_law_terms_urgent_check" CHECK (not "project_law_terms"."urgent" or "project_law_terms"."urgent_reason" is not null),
	CONSTRAINT "project_law_terms_bond_check" CHECK ("project_law_terms"."bid_bond_amount" is null or "project_law_terms"."bid_bond_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "strategy_evidence" (
	"device_type_id" integer PRIMARY KEY NOT NULL,
	"evidence" text NOT NULL,
	"updated_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"version" smallint NOT NULL,
	"file_name" text NOT NULL,
	"url" text NOT NULL,
	"size_bytes" integer,
	"kind" varchar(32),
	"expires_on" date,
	"uploaded_at" timestamp with time zone NOT NULL,
	"uploaded_by_id" integer,
	"note" text,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replaced_by_id" integer
);
--> statement-breakpoint
CREATE TABLE "error_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"path" text,
	"route" text,
	"method" varchar(12),
	"kind" varchar(16),
	"message" text NOT NULL,
	"digest" varchar(64),
	"stack" text
);
--> statement-breakpoint
CREATE TABLE "offline_sync_log" (
	"user_id" integer NOT NULL,
	"key" varchar(64) NOT NULL,
	"work_order_id" integer,
	"kind" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offline_sync_log_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "acceptances" ADD COLUMN "biomed_signed_by_id" integer;--> statement-breakpoint
ALTER TABLE "acceptances" ADD COLUMN "department_signed_by_id" integer;--> statement-breakpoint
ALTER TABLE "acceptances" ADD COLUMN "department_witness" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "uploaded_by_id" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "version" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "deleted_by_id" integer;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD COLUMN "dept_approved_by_id" integer;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD COLUMN "dept_approved_by_name" text;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD COLUMN "dept_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "po_penalty_terms" ADD CONSTRAINT "po_penalty_terms_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_law_terms" ADD CONSTRAINT "project_law_terms_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_evidence" ADD CONSTRAINT "strategy_evidence_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_replaced_by_id_users_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sync_log" ADD CONSTRAINT "offline_sync_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sync_log" ADD CONSTRAINT "offline_sync_log_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_doc_version_idx" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "document_versions_url_idx" ON "document_versions" USING btree ("url");--> statement-breakpoint
CREATE INDEX "error_log_at_idx" ON "error_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "offline_sync_log_work_order_idx" ON "offline_sync_log" USING btree ("work_order_id");--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_biomed_signed_by_id_users_id_fk" FOREIGN KEY ("biomed_signed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_department_signed_by_id_users_id_fk" FOREIGN KEY ("department_signed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_dept_approved_by_id_users_id_fk" FOREIGN KEY ("dept_approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;