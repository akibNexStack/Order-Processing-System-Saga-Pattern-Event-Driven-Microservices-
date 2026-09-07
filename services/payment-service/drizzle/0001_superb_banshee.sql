CREATE TABLE "simulated_provider_payments" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"saga_id" uuid NOT NULL,
	"fingerprint" varchar(64),
	"status" varchar(20) NOT NULL,
	"transaction_id" varchar(200),
	CONSTRAINT "sim_payment_status" CHECK ("simulated_provider_payments"."status" IN ('CHARGED', 'REFUNDED', 'NOOP'))
);
--> statement-breakpoint
CREATE TABLE "simulated_provider_requests" (
	"idempotency_key" varchar(255) PRIMARY KEY NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "charge_result" jsonb;