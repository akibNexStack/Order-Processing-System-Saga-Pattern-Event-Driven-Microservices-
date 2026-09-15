ALTER TABLE "products" ADD COLUMN "price_minor" bigint NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "active" boolean NOT NULL DEFAULT true;--> statement-breakpoint
UPDATE "products" SET
  "sku" = CASE "id"
    WHEN '44444444-4444-4444-8444-444444444444'::uuid THEN 'KEYBOARD-01'
    WHEN '55555555-5555-4555-8555-555555555555'::uuid THEN 'MOUSE-01'
    WHEN '66666666-6666-4666-8666-666666666666'::uuid THEN 'MONITOR-01'
    ELSE "sku"
  END,
  "name" = CASE "id"
    WHEN '44444444-4444-4444-8444-444444444444'::uuid THEN 'Mechanical Keyboard'
    WHEN '55555555-5555-4555-8555-555555555555'::uuid THEN 'Wireless Mouse'
    WHEN '66666666-6666-4666-8666-666666666666'::uuid THEN '27-inch Monitor'
    ELSE "name"
  END,
  "price_minor" = CASE "id"
    WHEN '44444444-4444-4444-8444-444444444444'::uuid THEN 250000
    WHEN '55555555-5555-4555-8555-555555555555'::uuid THEN 85000
    WHEN '66666666-6666-4666-8666-666666666666'::uuid THEN 3200000
    ELSE "price_minor"
  END;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "product_price_positive" CHECK ("products"."price_minor" > 0);
