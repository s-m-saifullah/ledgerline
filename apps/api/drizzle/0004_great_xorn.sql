CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"payee" text,
	"note" text,
	"transfer_id" uuid,
	"status" text DEFAULT 'cleared' NOT NULL,
	"fx_rate" integer DEFAULT 1 NOT NULL,
	"base_amount" bigint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "transactions_sign_check" CHECK (("transactions"."kind" = 'expense' AND "transactions"."amount" < 0) OR ("transactions"."kind" = 'income' AND "transactions"."amount" > 0)),
	CONSTRAINT "transactions_amount_check" CHECK ("transactions"."amount" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "transactions_usd_check" CHECK ("transactions"."currency" = 'USD' AND "transactions"."fx_rate" = 1 AND "transactions"."base_amount" = "transactions"."amount"),
	CONSTRAINT "transactions_status_check" CHECK ("transactions"."status" IN ('cleared', 'pending')),
	CONSTRAINT "transactions_payee_check" CHECK ("transactions"."payee" IS NULL OR char_length("transactions"."payee") <= 200),
	CONSTRAINT "transactions_note_check" CHECK ("transactions"."note" IS NULL OR char_length("transactions"."note") <= 2000),
	CONSTRAINT "transactions_date_check" CHECK ("transactions"."date" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
	CONSTRAINT "transactions_version_check" CHECK ("transactions"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_scoped_account_fk" FOREIGN KEY ("ledger_id","account_id") REFERENCES "public"."accounts"("ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_scoped_category_fk" FOREIGN KEY ("ledger_id","kind","category_id") REFERENCES "public"."categories"("ledger_id","kind","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_ledger_date_id_idx" ON "transactions" USING btree ("ledger_id","date","id");--> statement-breakpoint
CREATE INDEX "transactions_ledger_account_idx" ON "transactions" USING btree ("ledger_id","account_id");--> statement-breakpoint
CREATE INDEX "transactions_ledger_category_idx" ON "transactions" USING btree ("ledger_id","category_id");