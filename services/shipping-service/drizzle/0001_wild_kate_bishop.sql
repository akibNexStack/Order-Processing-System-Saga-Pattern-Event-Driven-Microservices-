CREATE TABLE "simulated_provider_requests" (
	"idempotency_key" varchar(255) PRIMARY KEY NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulated_provider_shipments" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"saga_id" uuid NOT NULL,
	"fingerprint" varchar(64),
	"status" varchar(20) NOT NULL,
	"shipment_id" varchar(200),
	CONSTRAINT "sim_shipment_status" CHECK ("simulated_provider_shipments"."status" IN ('CREATED', 'CANCELLED', 'NOOP'))
);
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "create_result" jsonb;