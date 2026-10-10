ALTER TABLE "transactions" ALTER COLUMN "fx_rate" SET DATA TYPE numeric(20, 10);--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "fx_rate" SET DEFAULT 1;--> statement-breakpoint
-- Existing lines are all USD at rate 1, so each line's base amount equals its amount.
ALTER TABLE "transaction_splits" ADD COLUMN "base_amount" bigint;--> statement-breakpoint
UPDATE "transaction_splits" SET "base_amount" = "amount";--> statement-breakpoint
ALTER TABLE "transaction_splits" ALTER COLUMN "base_amount" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "splits_base_amount_check" CHECK ("transaction_splits"."base_amount" BETWEEN -9007199254740991 AND 9007199254740991);--> statement-breakpoint
-- Split lines must now add up to the parent's base amount as well as its amount.
CREATE OR REPLACE FUNCTION ledgerline_check_split_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; scope uuid; parent transactions%ROWTYPE; line_count integer; total numeric; base_total numeric; valid boolean;
BEGIN
  FOR target, scope IN SELECT DISTINCT id, ledger FROM (VALUES
    (CASE WHEN TG_TABLE_NAME = 'transactions' AND TG_OP <> 'DELETE' THEN (to_jsonb(NEW)->>'id')::uuid WHEN TG_OP <> 'DELETE' THEN (to_jsonb(NEW)->>'transaction_id')::uuid END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.ledger_id END),
    (CASE WHEN TG_TABLE_NAME = 'transactions' AND TG_OP <> 'INSERT' THEN (to_jsonb(OLD)->>'id')::uuid WHEN TG_OP <> 'INSERT' THEN (to_jsonb(OLD)->>'transaction_id')::uuid END, CASE WHEN TG_OP <> 'INSERT' THEN OLD.ledger_id END)
  ) AS affected(id,ledger) WHERE id IS NOT NULL LOOP
    SELECT * INTO parent FROM transactions WHERE ledger_id=scope AND id=target;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF NOT parent.is_split THEN
      IF EXISTS (SELECT 1 FROM transaction_splits WHERE ledger_id=scope AND transaction_id=target AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Invalid split entry' USING ERRCODE='23514';
      END IF;
      CONTINUE;
    END IF;
    IF parent.deleted_at IS NOT NULL AND EXISTS (SELECT 1 FROM transaction_splits WHERE ledger_id=scope AND transaction_id=target AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Invalid split entry' USING ERRCODE='23514';
    END IF;
    SELECT count(*),sum(amount),sum(base_amount),bool_and(kind=parent.kind AND version=parent.version AND updated_at=parent.updated_at) INTO line_count,total,base_total,valid
      FROM transaction_splits WHERE ledger_id=scope AND transaction_id=target AND deleted_at IS NOT DISTINCT FROM parent.deleted_at AND (parent.deleted_at IS NULL OR version=parent.version);
    IF line_count < 2 OR line_count > 50 OR total IS DISTINCT FROM parent.amount::numeric OR base_total IS DISTINCT FROM parent.base_amount::numeric OR valid IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Invalid split entry' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
