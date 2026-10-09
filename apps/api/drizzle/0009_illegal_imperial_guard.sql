ALTER TABLE "receivable_payments" ADD COLUMN "receipt_id" uuid;--> statement-breakpoint
CREATE INDEX "payments_receipt_idx" ON "receivable_payments" USING btree ("ledger_id","receipt_id");