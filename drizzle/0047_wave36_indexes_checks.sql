-- Wave 36 (audit CO-10, DL-23): indexes on busy foreign keys; checks on quantities, money and stock.
-- The checks are NOT VALID: they hold for every new or changed row, but rows already in a hospital's database are
-- not re-checked here, so one odd old row can't stop the app from starting. Check old rows when convenient with
-- ALTER TABLE <table> VALIDATE CONSTRAINT <name>; (the full demo data passes them all).
CREATE INDEX "activity_actor_idx" ON "activity_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "approval_steps_approver_idx" ON "approval_steps" USING btree ("approver_user_id");--> statement-breakpoint
CREATE INDEX "asset_movements_asset_idx" ON "asset_movements" USING btree ("asset_id","moved_at");--> statement-breakpoint
CREATE INDEX "assets_po_line_idx" ON "assets" USING btree ("po_line_id");--> statement-breakpoint
CREATE INDEX "assets_delivery_line_idx" ON "assets" USING btree ("delivery_line_id");--> statement-breakpoint
CREATE INDEX "assets_parent_idx" ON "assets" USING btree ("parent_asset_id");--> statement-breakpoint
CREATE INDEX "bonds_po_idx" ON "bonds" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "boq_departments_boq_idx" ON "boq_departments" USING btree ("boq_id");--> statement-breakpoint
CREATE INDEX "boq_lines_department_idx" ON "boq_lines" USING btree ("boq_department_id");--> statement-breakpoint
CREATE INDEX "boq_lines_device_type_idx" ON "boq_lines" USING btree ("device_type_id");--> statement-breakpoint
CREATE INDEX "boqs_facility_idx" ON "boqs" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "boqs_project_idx" ON "boqs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "deliveries_po_idx" ON "deliveries" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "delivery_lines_delivery_idx" ON "delivery_lines" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "delivery_lines_po_line_idx" ON "delivery_lines" USING btree ("po_line_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_po_line_idx" ON "invoice_lines" USING btree ("po_line_id");--> statement-breakpoint
CREATE INDEX "offer_compliance_spec_item_idx" ON "offer_compliance" USING btree ("spec_item_id");--> statement-breakpoint
CREATE INDEX "offer_lines_offer_idx" ON "offer_lines" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "offer_lines_boq_line_idx" ON "offer_lines" USING btree ("boq_line_id");--> statement-breakpoint
CREATE INDEX "offer_lines_device_type_idx" ON "offer_lines" USING btree ("device_type_id");--> statement-breakpoint
CREATE INDEX "offers_rfq_idx" ON "offers" USING btree ("rfq_id");--> statement-breakpoint
CREATE INDEX "offers_supplier_idx" ON "offers" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "po_lines_po_idx" ON "po_lines" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "po_lines_offer_line_idx" ON "po_lines" USING btree ("offer_line_id");--> statement-breakpoint
CREATE INDEX "projects_facility_idx" ON "projects" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_project_idx" ON "purchase_orders" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_offer_idx" ON "purchase_orders" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_facility_idx" ON "purchase_orders" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "rfqs_project_idx" ON "rfqs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "round_items_asset_idx" ON "round_items" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "spec_items_spec_idx" ON "spec_items" USING btree ("spec_id");--> statement-breakpoint
CREATE INDEX "tech_specs_project_idx" ON "tech_specs" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_cost_check" CHECK ("assets"."purchase_cost" is null or "assets"."purchase_cost" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "bonds" ADD CONSTRAINT "bonds_amount_check" CHECK ("bonds"."amount" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "boq_lines" ADD CONSTRAINT "boq_lines_quantity_check" CHECK ("boq_lines"."quantity" >= 0 and "boq_lines"."calculated_qty" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "boq_lines" ADD CONSTRAINT "boq_lines_price_check" CHECK ("boq_lines"."unit_price_estimate" is null or "boq_lines"."unit_price_estimate" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "boq_rules" ADD CONSTRAINT "boq_rules_qty_check" CHECK ("boq_rules"."min_qty" >= 0 and ("boq_rules"."max_qty" is null or "boq_rules"."max_qty" >= "boq_rules"."min_qty")) NOT VALID;--> statement-breakpoint
ALTER TABLE "boqs" ADD CONSTRAINT "boqs_money_check" CHECK (("boqs"."target_budget" is null or "boqs"."target_budget" >= 0) and "boqs"."contingency_pct" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_amount_check" CHECK ("budget_lines"."amount" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "capital_budgets" ADD CONSTRAINT "capital_budgets_amount_check" CHECK ("capital_budgets"."amount" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_quantity_check" CHECK ("delivery_lines"."quantity" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_quantity_check" CHECK ("equipment_requests"."quantity" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "framework_items" ADD CONSTRAINT "framework_items_check" CHECK ("framework_items"."unit_price" >= 0 and ("framework_items"."max_qty" is null or "framework_items"."max_qty" >= 0)) NOT VALID;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_quantity_check" CHECK ("invoice_lines"."quantity" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_price_check" CHECK ("invoice_lines"."unit_price" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_events_cost_check" CHECK ("maintenance_events"."cost" is null or "maintenance_events"."cost" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "part_transactions" ADD CONSTRAINT "part_txn_quantity_check" CHECK ("part_transactions"."quantity" <> 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "part_transactions" ADD CONSTRAINT "part_txn_cost_check" CHECK ("part_transactions"."unit_cost" is null or "part_transactions"."unit_cost" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_received_max_check" CHECK ("po_lines"."received_qty" <= "po_lines"."quantity") NOT VALID;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_budget_check" CHECK ("projects"."budget" is null or "projects"."budget" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_quantity_check" CHECK ("rfq_lines"."quantity" is null or "rfq_lines"."quantity" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "spare_parts" ADD CONSTRAINT "spare_parts_stock_check" CHECK ("spare_parts"."stock_qty" >= 0 and "spare_parts"."min_qty" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "spare_parts" ADD CONSTRAINT "spare_parts_cost_check" CHECK ("spare_parts"."unit_cost" is null or "spare_parts"."unit_cost" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_cost_check" CHECK ("work_orders"."cost" is null or "work_orders"."cost" >= 0) NOT VALID;