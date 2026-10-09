ALTER TABLE "transactions" DROP CONSTRAINT "transactions_sign_check";--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "category_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_transfer_direction_idx" ON "transactions" USING btree ("ledger_id","transfer_id",("amount" > 0)) WHERE "transactions"."transfer_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_check" CHECK (("transactions"."kind" = 'transfer' AND "transactions"."transfer_id" IS NOT NULL AND "transactions"."category_id" IS NULL AND "transactions"."status" = 'cleared' AND "transactions"."payee" IS NULL) OR ("transactions"."kind" IN ('expense', 'income') AND "transactions"."transfer_id" IS NULL AND "transactions"."category_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sign_check" CHECK (("transactions"."kind" = 'expense' AND "transactions"."amount" < 0) OR ("transactions"."kind" = 'income' AND "transactions"."amount" > 0) OR ("transactions"."kind" = 'transfer' AND "transactions"."amount" <> 0));--> statement-breakpoint
-- Check the final pair at commit so either leg can be written first inside one transaction.
CREATE FUNCTION ledgerline_check_transfer_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; scope uuid; pair_count integer; valid boolean;
BEGIN
  FOR target, scope IN SELECT DISTINCT id, ledger FROM (VALUES
    (CASE WHEN TG_OP <> 'DELETE' THEN NEW.transfer_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.ledger_id END),
    (CASE WHEN TG_OP <> 'INSERT' THEN OLD.transfer_id END, CASE WHEN TG_OP <> 'INSERT' THEN OLD.ledger_id END)
  ) AS affected(id, ledger) WHERE id IS NOT NULL LOOP
    SELECT count(*) INTO pair_count FROM transactions WHERE ledger_id = scope AND transfer_id = target;
    IF pair_count = 0 THEN CONTINUE; END IF;
    SELECT a.account_id <> b.account_id AND a.amount = -b.amount
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
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transactions_transfer_pair_check
AFTER INSERT OR UPDATE OR DELETE ON transactions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ledgerline_check_transfer_pair();
