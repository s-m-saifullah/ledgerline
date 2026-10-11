-- Transfer bonus (ADR 0023): optional inbound bonus settings on accounts and a link from the bonus income entry to its transfer.
ALTER TABLE "accounts" ADD COLUMN "inbound_bonus_bps" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "bonus_category_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "related_transfer_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_ledger_id_id_idx" ON "categories" USING btree ("ledger_id","id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_scoped_bonus_category_fk" FOREIGN KEY ("ledger_id","bonus_category_id") REFERENCES "public"."categories"("ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_related_transfer_idx" ON "transactions" USING btree ("ledger_id","related_transfer_id") WHERE "transactions"."related_transfer_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_bonus_rate_check" CHECK ("accounts"."inbound_bonus_bps" IS NULL OR "accounts"."inbound_bonus_bps" BETWEEN 1 AND 10000);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_related_transfer_check" CHECK ("transactions"."related_transfer_id" IS NULL OR ("transactions"."kind" = 'income' AND "transactions"."transfer_id" IS NULL AND NOT "transactions"."is_split" AND "transactions"."receivable_payment_id" IS NULL));
