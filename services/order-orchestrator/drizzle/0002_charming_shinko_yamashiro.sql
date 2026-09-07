CREATE TABLE "message_inbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_fingerprint_valid" CHECK ("message_inbox"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "message_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"route" varchar(100) NOT NULL,
	"envelope" jsonb NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_envelope_object" CHECK (jsonb_typeof("message_outbox"."envelope") = 'object')
);
--> statement-breakpoint
ALTER TABLE "saga_instances" ADD COLUMN "pending_message_id" uuid;--> statement-breakpoint
ALTER TABLE "saga_instances" ADD COLUMN "broker_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "message_outbox" USING btree ("available_at") WHERE "message_outbox"."published_at" IS NULL;