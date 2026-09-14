ALTER TABLE "orders" ADD COLUMN "payment_method" varchar(20) NOT NULL DEFAULT 'COD';--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "order_payment_method_valid" CHECK ("orders"."payment_method" IN ('COD', 'BANK_TRANSFER'));--> statement-breakpoint
ALTER TABLE "saga_instances" DROP CONSTRAINT "saga_status_valid";--> statement-breakpoint
ALTER TABLE "saga_instances" ADD CONSTRAINT "saga_status_valid" CHECK ("saga_instances"."status" IN ('PENDING_PAYMENT', 'IN_PROGRESS', 'COMPENSATING', 'COMPLETED', 'FAILED'));--> statement-breakpoint
ALTER TABLE "saga_transitions" DROP CONSTRAINT "transition_from_valid";--> statement-breakpoint
ALTER TABLE "saga_transitions" ADD CONSTRAINT "transition_from_valid" CHECK ("saga_transitions"."from_status" IS NULL OR "saga_transitions"."from_status" IN ('PENDING_PAYMENT', 'IN_PROGRESS', 'COMPENSATING', 'COMPLETED', 'FAILED'));--> statement-breakpoint
ALTER TABLE "saga_transitions" DROP CONSTRAINT "transition_to_valid";--> statement-breakpoint
ALTER TABLE "saga_transitions" ADD CONSTRAINT "transition_to_valid" CHECK ("saga_transitions"."to_status" IN ('PENDING_PAYMENT', 'IN_PROGRESS', 'COMPENSATING', 'COMPLETED', 'FAILED'));
