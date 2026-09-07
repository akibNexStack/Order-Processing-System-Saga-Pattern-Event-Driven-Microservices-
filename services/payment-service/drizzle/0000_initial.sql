CREATE TABLE "command_receipts" (
	"idempotency_key" varchar(255) PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"saga_id" uuid NOT NULL,
	"operation" varchar(50) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'PROCESSING' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_key_valid" CHECK ("command_receipts"."idempotency_key" ~ '^[A-Za-z0-9:_-]{1,255}$'),
	CONSTRAINT "receipt_fingerprint_valid" CHECK ("command_receipts"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "receipt_status_valid" CHECK ("command_receipts"."status" IN ('PROCESSING', 'COMPLETED')),
	CONSTRAINT "receipt_operation_valid" CHECK ("command_receipts"."operation" IN ('CHARGE_PAYMENT', 'REFUND_PAYMENT')),
	CONSTRAINT "receipt_result_valid" CHECK (("command_receipts"."status" = 'PROCESSING' AND "command_receipts"."result" IS NULL) OR ("command_receipts"."status" = 'COMPLETED' AND "command_receipts"."result" IS NOT NULL AND jsonb_typeof("command_receipts"."result") = 'object'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"saga_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"provider_transaction_id" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refunded_at" timestamp with time zone,
	CONSTRAINT "payments_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "payments_provider_transaction_id_unique" UNIQUE("provider_transaction_id"),
	CONSTRAINT "payments_id_order_unique" UNIQUE("id","order_id"),
	CONSTRAINT "payment_amount_valid" CHECK ("payments"."amount_minor" BETWEEN 1 AND 9999999999),
	CONSTRAINT "payment_currency_valid" CHECK ("payments"."currency" IN ('USD', 'BDT')),
	CONSTRAINT "payment_status_valid" CHECK ("payments"."status" IN ('PENDING', 'CHARGED', 'REFUNDED', 'FAILED')),
	CONSTRAINT "payment_provider_required" CHECK ("payments"."status" NOT IN ('CHARGED', 'REFUNDED') OR "payments"."provider_transaction_id" IS NOT NULL),
	CONSTRAINT "payment_refund_time_valid" CHECK (("payments"."status" = 'REFUNDED') = ("payments"."refunded_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"saga_id" uuid NOT NULL,
	"payment_id" uuid,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"provider_refund_id" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "refunds_provider_refund_id_unique" UNIQUE("provider_refund_id"),
	CONSTRAINT "refund_status_valid" CHECK ("refunds"."status" IN ('PENDING', 'REFUNDED', 'NOOP')),
	CONSTRAINT "refund_payment_required" CHECK ("refunds"."status" <> 'REFUNDED' OR "refunds"."payment_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_order_id_payments_id_order_id_fk" FOREIGN KEY ("payment_id","order_id") REFERENCES "public"."payments"("id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_order_idx" ON "command_receipts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "receipts_recovery_idx" ON "command_receipts" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "payments_customer_idx" ON "payments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "payments_saga_idx" ON "payments" USING btree ("saga_id");--> statement-breakpoint
CREATE INDEX "refunds_saga_idx" ON "refunds" USING btree ("saga_id");