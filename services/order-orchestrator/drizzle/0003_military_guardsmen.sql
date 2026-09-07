ALTER TABLE "saga_instances" ADD COLUMN "response_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saga_instances" ADD COLUMN "recovery_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "saga_instances" ADD COLUMN "intervention_reason" text;--> statement-breakpoint
ALTER TABLE "saga_instances" ADD CONSTRAINT "saga_recovery_attempts_valid" CHECK ("saga_instances"."recovery_attempts" >= 0);