ALTER TABLE "payments" ADD COLUMN "payment_method" varchar(20) NOT NULL DEFAULT 'COD';--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payment_method_valid" CHECK ("payments"."payment_method" IN ('COD', 'BANK_TRANSFER'));--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payment_status_valid";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payment_status_valid" CHECK ("payments"."status" IN ('PENDING', 'PAY_ON_DELIVERY', 'CHARGED', 'REFUNDED', 'FAILED'));--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payment_provider_required";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payment_provider_required" CHECK ("payments"."status" NOT IN ('CHARGED', 'REFUNDED', 'PAY_ON_DELIVERY') OR "payments"."provider_transaction_id" IS NOT NULL);
