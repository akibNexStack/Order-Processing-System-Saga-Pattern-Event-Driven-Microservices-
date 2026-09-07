CREATE TABLE "order_items" (
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "order_items_order_id_product_id_pk" PRIMARY KEY("order_id","product_id"),
	CONSTRAINT "order_quantity_valid" CHECK ("order_items"."quantity" BETWEEN 1 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_customer_key_unique" UNIQUE("customer_id","idempotency_key"),
	CONSTRAINT "order_key_valid" CHECK ("orders"."idempotency_key" ~ '^[A-Za-z0-9:_-]{1,255}$'),
	CONSTRAINT "order_fingerprint_valid" CHECK ("orders"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "order_amount_valid" CHECK ("orders"."amount_minor" BETWEEN 1 AND 9999999999),
	CONSTRAINT "order_currency_valid" CHECK ("orders"."currency" IN ('USD', 'BDT')),
	CONSTRAINT "order_address_object" CHECK (jsonb_typeof("orders"."shipping_address") = 'object')
);
--> statement-breakpoint
CREATE TABLE "saga_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"current_step" varchar(20) DEFAULT 'PAYMENT' NOT NULL,
	"status" varchar(20) DEFAULT 'IN_PROGRESS' NOT NULL,
	"completed_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"compensated_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saga_instances_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "saga_status_valid" CHECK ("saga_instances"."status" IN ('IN_PROGRESS', 'COMPENSATING', 'COMPLETED', 'FAILED')),
	CONSTRAINT "saga_step_valid" CHECK ("saga_instances"."current_step" IN ('PAYMENT', 'INVENTORY', 'SHIPPING')),
	CONSTRAINT "saga_completed_valid" CHECK (jsonb_typeof("saga_instances"."completed_steps") = 'array' AND "saga_instances"."completed_steps" <@ '["PAYMENT","INVENTORY","SHIPPING"]'::jsonb),
	CONSTRAINT "saga_compensated_valid" CHECK (jsonb_typeof("saga_instances"."compensated_steps") = 'array' AND "saga_instances"."compensated_steps" <@ "saga_instances"."completed_steps"),
	CONSTRAINT "saga_payload_object" CHECK (jsonb_typeof("saga_instances"."payload") = 'object'),
	CONSTRAINT "saga_counters_valid" CHECK ("saga_instances"."version" >= 0 AND "saga_instances"."attempts" >= 0),
	CONSTRAINT "saga_lease_valid" CHECK (("saga_instances"."lease_owner" IS NULL) = ("saga_instances"."lease_expires_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "saga_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"saga_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"from_status" varchar(20),
	"to_status" varchar(20) NOT NULL,
	"step" varchar(20) NOT NULL,
	"direction" varchar(20) NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transition_sequence_unique" UNIQUE("saga_id","sequence"),
	CONSTRAINT "transition_sequence_valid" CHECK ("saga_transitions"."sequence" > 0),
	CONSTRAINT "transition_from_valid" CHECK ("saga_transitions"."from_status" IS NULL OR "saga_transitions"."from_status" IN ('IN_PROGRESS', 'COMPENSATING', 'COMPLETED', 'FAILED')),
	CONSTRAINT "transition_to_valid" CHECK ("saga_transitions"."to_status" IN ('IN_PROGRESS', 'COMPENSATING', 'COMPLETED', 'FAILED')),
	CONSTRAINT "transition_step_valid" CHECK ("saga_transitions"."step" IN ('PAYMENT', 'INVENTORY', 'SHIPPING')),
	CONSTRAINT "transition_direction_valid" CHECK ("saga_transitions"."direction" IN ('FORWARD', 'COMPENSATION')),
	CONSTRAINT "transition_details_object" CHECK (jsonb_typeof("saga_transitions"."details") = 'object')
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saga_instances" ADD CONSTRAINT "saga_instances_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saga_transitions" ADD CONSTRAINT "saga_transitions_saga_id_saga_instances_id_fk" FOREIGN KEY ("saga_id") REFERENCES "public"."saga_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "saga_recovery_idx" ON "saga_instances" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "saga_stale_idx" ON "saga_instances" USING btree ("status","updated_at");