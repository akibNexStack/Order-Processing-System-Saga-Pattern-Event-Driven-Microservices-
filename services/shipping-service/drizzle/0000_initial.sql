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
	CONSTRAINT "receipt_operation_valid" CHECK ("command_receipts"."operation" IN ('CREATE_SHIPMENT', 'CANCEL_SHIPMENT')),
	CONSTRAINT "receipt_result_valid" CHECK (("command_receipts"."status" = 'PROCESSING' AND "command_receipts"."result" IS NULL) OR ("command_receipts"."status" = 'COMPLETED' AND "command_receipts"."result" IS NOT NULL AND jsonb_typeof("command_receipts"."result") = 'object'))
);
--> statement-breakpoint
CREATE TABLE "shipment_cancellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"saga_id" uuid NOT NULL,
	"shipment_id" uuid,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_cancellations_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "cancellation_status_valid" CHECK ("shipment_cancellations"."status" IN ('PENDING', 'CANCELLED', 'NOOP')),
	CONSTRAINT "cancellation_shipment_required" CHECK ("shipment_cancellations"."status" <> 'CANCELLED' OR "shipment_cancellations"."shipment_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"saga_id" uuid NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"provider_shipment_id" varchar(200),
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "shipments_provider_shipment_id_unique" UNIQUE("provider_shipment_id"),
	CONSTRAINT "shipments_id_order_unique" UNIQUE("id","order_id"),
	CONSTRAINT "shipment_status_valid" CHECK ("shipments"."status" IN ('PENDING', 'CREATED', 'CANCELLED', 'FAILED')),
	CONSTRAINT "shipment_address_object" CHECK (jsonb_typeof("shipments"."shipping_address") = 'object'),
	CONSTRAINT "shipment_items_valid" CHECK (CASE WHEN jsonb_typeof("shipments"."items") = 'array' THEN jsonb_array_length("shipments"."items") BETWEEN 1 AND 100 ELSE false END),
	CONSTRAINT "shipment_provider_required" CHECK ("shipments"."status" NOT IN ('CREATED', 'CANCELLED') OR "shipments"."provider_shipment_id" IS NOT NULL),
	CONSTRAINT "shipment_cancel_time_valid" CHECK (("shipments"."status" = 'CANCELLED') = ("shipments"."cancelled_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "shipment_cancellations" ADD CONSTRAINT "shipment_cancellations_shipment_id_order_id_shipments_id_order_id_fk" FOREIGN KEY ("shipment_id","order_id") REFERENCES "public"."shipments"("id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_order_idx" ON "command_receipts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "receipts_recovery_idx" ON "command_receipts" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "cancellations_saga_idx" ON "shipment_cancellations" USING btree ("saga_id");--> statement-breakpoint
CREATE INDEX "shipments_saga_idx" ON "shipments" USING btree ("saga_id");