-- Transfer fee (ADR 0025): optional fee settings on accounts and a link from the fee expense entry to its transfer.
ALTER TABLE "accounts" ADD COLUMN "fee_category_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "default_fee_amount" bigint;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "default_fee_bps" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "fee_transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_scoped_fee_category_fk" FOREIGN KEY ("ledger_id","fee_category_id") REFERENCES "public"."categories"("ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_fee_transfer_idx" ON "transactions" USING btree ("ledger_id","fee_transfer_id") WHERE "transactions"."fee_transfer_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_default_fee_check" CHECK (("accounts"."default_fee_amount" IS NULL OR "accounts"."default_fee_amount" > 0) AND ("accounts"."default_fee_bps" IS NULL OR "accounts"."default_fee_bps" BETWEEN 1 AND 10000) AND ("accounts"."default_fee_amount" IS NULL OR "accounts"."default_fee_bps" IS NULL));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_fee_transfer_check" CHECK ("transactions"."fee_transfer_id" IS NULL OR ("transactions"."kind" = 'expense' AND "transactions"."transfer_id" IS NULL AND NOT "transactions"."is_split" AND "transactions"."receivable_payment_id" IS NULL AND "transactions"."related_transfer_id" IS NULL));