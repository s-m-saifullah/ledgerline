ALTER TABLE "ledgers" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "ledgers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledgers" ADD CONSTRAINT "ledgers_version_check" CHECK ("ledgers"."version" >= 1);