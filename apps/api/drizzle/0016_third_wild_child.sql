-- Money owed in other currencies (ADR 0022): an item and its payments may use any currency; a payment is always in its item's currency.
ALTER TABLE "receivable_payments" DROP CONSTRAINT "payments_money_check";--> statement-breakpoint
ALTER TABLE "receivables" DROP CONSTRAINT "receivables_money_check";--> statement-breakpoint
CREATE UNIQUE INDEX "receivables_scope_currency_idx" ON "receivables" USING btree ("ledger_id","id","currency");--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "payments_receivable_currency_fk" FOREIGN KEY ("ledger_id","receivable_id","currency") REFERENCES "public"."receivables"("ledger_id","id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "payments_money_check" CHECK ("receivable_payments"."amount" between 1 and 9007199254740991 AND "receivable_payments"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_money_check" CHECK ("receivables"."amount" between 1 and 9007199254740991 AND "receivables"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
-- A payment's income entry is in the receiving account's currency. In the item's own currency it
-- carries the payment's amount exactly; in another currency it carries the amount received.
CREATE OR REPLACE FUNCTION ledgerline_check_receivable(book uuid, service_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE service receivables%ROWTYPE; received numeric;
BEGIN
  SELECT * INTO service FROM receivables WHERE ledger_id=book AND id=service_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT coalesce(sum(amount),0) INTO received FROM receivable_payments WHERE ledger_id=book AND receivable_id=service_id AND deleted_at IS NULL;
  IF received > service.amount OR (service.deleted_at IS NOT NULL AND received <> 0) OR
    (service.written_off_at IS NOT NULL AND service.written_off_amount IS DISTINCT FROM service.amount-received) THEN
    RAISE EXCEPTION 'Invalid receivable allocation' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM receivable_payments p LEFT JOIN transactions t ON t.ledger_id=p.ledger_id AND t.id=p.transaction_id
    WHERE p.ledger_id=book AND p.receivable_id=service_id AND
      (t.id IS NULL OR t.receivable_payment_id IS DISTINCT FROM p.id OR t.receivable_id IS DISTINCT FROM p.receivable_id OR
       (t.currency = p.currency AND t.amount <> p.amount) OR t.kind <> 'income' OR t.status <> 'cleared' OR t.is_split OR t.transfer_id IS NOT NULL OR
       t.version <> p.version OR t.deleted_at IS DISTINCT FROM p.deleted_at)
  ) OR EXISTS (
    SELECT 1 FROM transactions t LEFT JOIN receivable_payments p ON p.ledger_id=t.ledger_id AND p.id=t.receivable_payment_id
    WHERE t.ledger_id=book AND t.receivable_id=service_id AND
      (p.id IS NULL OR p.transaction_id IS DISTINCT FROM t.id OR p.receivable_id IS DISTINCT FROM t.receivable_id)
  ) THEN RAISE EXCEPTION 'Invalid linked income' USING ERRCODE='23514'; END IF;
END $$;
