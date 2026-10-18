CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source_name" text,
	"row_count" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "import_batches_fields_check" CHECK ("import_batches"."row_count" BETWEEN 1 AND 5000 AND ("import_batches"."source_name" IS NULL OR char_length("import_batches"."source_name") BETWEEN 1 AND 200)),
	CONSTRAINT "import_batches_version_check" CHECK ("import_batches"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_scoped_account_fk" FOREIGN KEY ("ledger_id","account_id") REFERENCES "public"."accounts"("ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_scope_idx" ON "import_batches" USING btree ("ledger_id","id");--> statement-breakpoint
CREATE INDEX "import_batches_ledger_created_idx" ON "import_batches" USING btree ("ledger_id","created_at");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_scoped_import_batch_fk" FOREIGN KEY ("ledger_id","import_batch_id") REFERENCES "public"."import_batches"("ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_ledger_import_batch_idx" ON "transactions" USING btree ("ledger_id","import_batch_id") WHERE "transactions"."import_batch_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_check" CHECK ("transactions"."import_batch_id" IS NULL OR ("transactions"."kind" IN ('income', 'expense') AND "transactions"."transfer_id" IS NULL AND NOT "transactions"."is_split" AND "transactions"."receivable_payment_id" IS NULL AND "transactions"."related_transfer_id" IS NULL AND "transactions"."fee_transfer_id" IS NULL AND "transactions"."tip_payment_id" IS NULL));