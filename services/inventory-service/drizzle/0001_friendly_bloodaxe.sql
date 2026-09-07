ALTER TABLE "command_receipts" DROP CONSTRAINT "receipt_operation_valid";--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "reserve_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "reserve_result" jsonb;--> statement-breakpoint
ALTER TABLE "command_receipts" ADD CONSTRAINT "receipt_operation_valid" CHECK ("command_receipts"."operation" IN ('RESERVE_INVENTORY', 'RELEASE_INVENTORY', 'FINALIZE_INVENTORY'));