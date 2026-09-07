ALTER TABLE "saga_instances" ADD COLUMN "current_operation" varchar(50) DEFAULT 'CHARGE_PAYMENT' NOT NULL;--> statement-breakpoint
ALTER TABLE "saga_instances" ADD COLUMN "inventory_finalized" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "saga_instances" ADD COLUMN "last_result" jsonb;--> statement-breakpoint
ALTER TABLE "saga_instances" ADD CONSTRAINT "saga_operation_valid" CHECK ("saga_instances"."current_operation" IN ('CHARGE_PAYMENT', 'RESERVE_INVENTORY', 'CREATE_SHIPMENT', 'FINALIZE_INVENTORY'));