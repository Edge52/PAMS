ALTER TABLE "flow_steps" ADD COLUMN "room_code" varchar(32);--> statement-breakpoint
ALTER TABLE "flow_steps" ADD COLUMN "room_label" text;--> statement-breakpoint
UPDATE "flow_steps" s SET "room_code" = r."code", "room_label" = r."name" FROM "rooms" r WHERE r."id" = s."room_id";
