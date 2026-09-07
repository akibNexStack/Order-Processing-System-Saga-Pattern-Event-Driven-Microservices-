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
	CONSTRAINT "receipt_operation_valid" CHECK ("command_receipts"."operation" IN ('RESERVE_INVENTORY', 'RELEASE_INVENTORY')),
	CONSTRAINT "receipt_result_valid" CHECK (("command_receipts"."status" = 'PROCESSING' AND "command_receipts"."result" IS NULL) OR ("command_receipts"."status" = 'COMPLETED' AND "command_receipts"."result" IS NOT NULL AND jsonb_typeof("command_receipts"."result") = 'object'))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"available_stock" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku"),
	CONSTRAINT "stock_nonnegative" CHECK ("products"."available_stock" >= 0),
	CONSTRAINT "product_text_valid" CHECK (length(trim("products"."sku")) > 0 AND length(trim("products"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "reservation_items" (
	"reservation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "reservation_items_reservation_id_product_id_pk" PRIMARY KEY("reservation_id","product_id"),
	CONSTRAINT "reservation_quantity_valid" CHECK ("reservation_items"."quantity" BETWEEN 1 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"saga_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "reservation_status_valid" CHECK ("reservations"."status" IN ('PENDING', 'RESERVED', 'RELEASED', 'FINALIZED', 'FAILED')),
	CONSTRAINT "reservation_expiry_valid" CHECK ("reservations"."expires_at" IS NULL OR "reservations"."expires_at" > "reservations"."created_at")
);
--> statement-breakpoint
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_order_idx" ON "command_receipts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "receipts_recovery_idx" ON "command_receipts" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "reservation_items_product_idx" ON "reservation_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "reservations_saga_idx" ON "reservations" USING btree ("saga_id");--> statement-breakpoint
CREATE INDEX "reservations_expiry_idx" ON "reservations" USING btree ("status","expires_at");