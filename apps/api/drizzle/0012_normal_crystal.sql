CREATE TABLE "currencies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "currencies_code_check" CHECK ("currencies"."code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "currencies_version_check" CHECK ("currencies"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"code" text NOT NULL,
	"date" date NOT NULL,
	"rate" numeric(20, 10) NOT NULL,
	"source" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "exchange_rates_code_check" CHECK ("exchange_rates"."code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "exchange_rates_rate_check" CHECK ("exchange_rates"."rate" > 0),
	CONSTRAINT "exchange_rates_source_check" CHECK ("exchange_rates"."source" IN ('api', 'manual')),
	CONSTRAINT "exchange_rates_version_check" CHECK ("exchange_rates"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "currencies" ADD CONSTRAINT "currencies_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "currencies_ledger_code_idx" ON "currencies" USING btree ("ledger_id","code") WHERE "currencies"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_ledger_code_date_idx" ON "exchange_rates" USING btree ("ledger_id","code","date") WHERE "exchange_rates"."deleted_at" IS NULL;