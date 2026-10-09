CREATE TABLE "transaction_splits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"note" text,
	"position" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "splits_sign_check" CHECK (("transaction_splits"."kind" = 'expense' AND "transaction_splits"."amount" < 0) OR ("transaction_splits"."kind" = 'income' AND "transaction_splits"."amount" > 0)),
	CONSTRAINT "splits_amount_check" CHECK ("transaction_splits"."amount" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "splits_note_check" CHECK ("transaction_splits"."note" IS NULL OR char_length("transaction_splits"."note") <= 2000),
	CONSTRAINT "splits_position_check" CHECK ("transaction_splits"."position" BETWEEN 0 AND 49),
	CONSTRAINT "splits_version_check" CHECK ("transaction_splits"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_transfer_check";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "is_split" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_scope_id_idx" ON "transactions" USING btree ("ledger_id","id");--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "splits_scoped_transaction_fk" FOREIGN KEY ("ledger_id","transaction_id") REFERENCES "public"."transactions"("ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "splits_scoped_category_fk" FOREIGN KEY ("ledger_id","kind","category_id") REFERENCES "public"."categories"("ledger_id","kind","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "splits_ledger_transaction_idx" ON "transaction_splits" USING btree ("ledger_id","transaction_id");--> statement-breakpoint
CREATE INDEX "splits_ledger_category_idx" ON "transaction_splits" USING btree ("ledger_id","category_id");--> statement-breakpoint

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_check" CHECK (("transactions"."kind" = 'transfer' AND "transactions"."transfer_id" IS NOT NULL AND "transactions"."category_id" IS NULL AND "transactions"."status" = 'cleared' AND "transactions"."payee" IS NULL AND NOT "transactions"."is_split") OR ("transactions"."kind" IN ('expense', 'income') AND "transactions"."transfer_id" IS NULL AND (("transactions"."is_split" AND "transactions"."category_id" IS NULL) OR (NOT "transactions"."is_split" AND "transactions"."category_id" IS NOT NULL))));
--> statement-breakpoint
-- Parent and category allocations must describe one complete entry at commit.
CREATE FUNCTION ledgerline_check_split_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; scope uuid; parent transactions%ROWTYPE; line_count integer; total numeric; valid boolean;
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
    SELECT count(*),sum(amount),bool_and(kind=parent.kind AND version=parent.version AND updated_at=parent.updated_at) INTO line_count,total,valid
      FROM transaction_splits WHERE ledger_id=scope AND transaction_id=target AND deleted_at IS NOT DISTINCT FROM parent.deleted_at AND (parent.deleted_at IS NULL OR version=parent.version);
    IF line_count < 2 OR line_count > 50 OR total IS DISTINCT FROM parent.amount::numeric OR valid IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Invalid split entry' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transactions_split_parent_check AFTER INSERT OR UPDATE OR DELETE ON transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledgerline_check_split_parent();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER splits_parent_check AFTER INSERT OR UPDATE OR DELETE ON transaction_splits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledgerline_check_split_parent();
