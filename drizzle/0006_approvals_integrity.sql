CREATE UNIQUE INDEX "approval_requests_one_pending_uq" ON "approval_requests" USING btree ("entity","entity_id") WHERE status = 'PENDING';--> statement-breakpoint
-- Awards made before 2.1 had no approval step: treat them as approved on their last update, with the Law 182
-- complaint window already over and the acceptance notice sent, so POs can still be raised from them.
UPDATE "offers" SET "award_approved_on" = COALESCE("award_approved_on", "updated_at"::date),
  "complaint_until" = COALESCE("complaint_until", "updated_at"::date),
  "acceptance_due" = COALESCE("acceptance_due", "updated_at"::date),
  "accepted_on" = COALESCE("accepted_on", "updated_at"::date)
WHERE "status" = 'AWARDED' AND "award_approved_on" IS NULL;
