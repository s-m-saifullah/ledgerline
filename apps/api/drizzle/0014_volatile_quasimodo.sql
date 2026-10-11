-- Entries may now be in any currency; each entry's currency must be its account's currency.
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_currency_check";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_usd_check";--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "fx_rate" SET DEFAULT '1';--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_ledger_id_currency_idx" ON "accounts" USING btree ("ledger_id","id","currency");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_currency_check" CHECK ("accounts"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_currency_fk" FOREIGN KEY ("ledger_id","account_id","currency") REFERENCES "public"."accounts"("ledger_id","id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_currency_check" CHECK ("transactions"."currency" ~ '^[A-Z]{3}$' AND "transactions"."fx_rate" > 0 AND ("transactions"."currency" <> 'USD' OR ("transactions"."fx_rate" = 1 AND "transactions"."base_amount" = "transactions"."amount")));--> statement-breakpoint
-- The two legs of a transfer now net to zero in the base currency; within one currency they
-- are also exact opposites. A transfer between currencies has different amounts on each leg.
CREATE OR REPLACE FUNCTION ledgerline_check_transfer_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; scope uuid; pair_count integer; valid boolean;
BEGIN
  FOR target, scope IN SELECT DISTINCT id, ledger FROM (VALUES
    (CASE WHEN TG_OP <> 'DELETE' THEN NEW.transfer_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.ledger_id END),
    (CASE WHEN TG_OP <> 'INSERT' THEN OLD.transfer_id END, CASE WHEN TG_OP <> 'INSERT' THEN OLD.ledger_id END)
  ) AS affected(id, ledger) WHERE id IS NOT NULL LOOP
    SELECT count(*) INTO pair_count FROM transactions WHERE ledger_id = scope AND transfer_id = target;
    IF pair_count = 0 THEN CONTINUE; END IF;
    SELECT a.account_id <> b.account_id AND a.base_amount = -b.base_amount
      AND (a.currency <> b.currency OR a.amount = -b.amount)
      AND a.kind = 'transfer' AND b.kind = 'transfer'
      AND a.date = b.date AND a.time IS NOT DISTINCT FROM b.time
      AND a.note IS NOT DISTINCT FROM b.note AND a.version = b.version
      AND a.deleted_at IS NOT DISTINCT FROM b.deleted_at
      AND a.created_at = b.created_at AND a.updated_at = b.updated_at
      INTO valid FROM transactions a JOIN transactions b ON a.ledger_id=b.ledger_id AND a.transfer_id=b.transfer_id
      WHERE a.ledger_id=scope AND a.transfer_id=target AND a.amount < 0 AND b.amount > 0;
    IF pair_count <> 2 OR valid IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Invalid transfer pair' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
