CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"opening_balance" bigint NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "accounts_name_check" CHECK (char_length(btrim("accounts"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "accounts_type_check" CHECK ("accounts"."type" IN ('bank', 'cash', 'card', 'wallet', 'loan', 'savings')),
	CONSTRAINT "accounts_currency_check" CHECK ("accounts"."currency" = 'USD'),
	CONSTRAINT "accounts_opening_balance_check" CHECK ("accounts"."opening_balance" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "accounts_version_check" CHECK ("accounts"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_ledger_id_id_idx" ON "accounts" USING btree ("ledger_id","id");