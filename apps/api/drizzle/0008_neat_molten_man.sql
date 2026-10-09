CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"note" text,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "contacts_fields_check" CHECK (char_length(btrim("contacts"."name")) between 1 and 100 AND char_length("contacts"."phone") <= 100 AND char_length("contacts"."email") <= 254 AND char_length("contacts"."note") <= 2000),
	CONSTRAINT "contacts_version_check" CHECK ("contacts"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "receivable_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"receivable_id" uuid NOT NULL,
	"payment_id" uuid,
	"transaction_id" uuid,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"receivable_version" integer NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "events_action_check" CHECK ("receivable_events"."action" IN ('created','edited','deleted','restored','writtenOff','reopened','paymentCreated','paymentEdited','paymentDeleted','paymentRestored')),
	CONSTRAINT "events_version_check" CHECK ("receivable_events"."receivable_version" >= 1),
	CONSTRAINT "events_snapshot_check" CHECK (octet_length("receivable_events"."after"::text) <= 65536 AND ("receivable_events"."before" IS NULL OR octet_length("receivable_events"."before"::text) <= 65536))
);
--> statement-breakpoint
CREATE TABLE "receivable_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"receivable_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "payments_money_check" CHECK ("receivable_payments"."amount" between 1 and 9007199254740991 AND "receivable_payments"."currency"='USD'),
	CONSTRAINT "payments_version_check" CHECK ("receivable_payments"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "receivables" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"description" text NOT NULL,
	"service_date" date NOT NULL,
	"due_date" date,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"written_off_at" timestamp with time zone,
	"written_off_amount" bigint,
	"write_off_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "receivables_money_check" CHECK ("receivables"."amount" between 1 and 9007199254740991 AND "receivables"."currency"='USD'),
	CONSTRAINT "receivables_fields_check" CHECK (char_length(btrim("receivables"."description")) between 1 and 2000 AND char_length("receivables"."write_off_reason") <= 2000 AND "receivables"."service_date" between date '0001-01-01' and date '9999-12-31' AND ("receivables"."due_date" IS NULL OR "receivables"."due_date" between date '0001-01-01' and date '9999-12-31')),
	CONSTRAINT "receivables_waiver_check" CHECK (("receivables"."written_off_at" IS NULL AND "receivables"."written_off_amount" IS NULL AND "receivables"."write_off_reason" IS NULL) OR ("receivables"."written_off_at" IS NOT NULL AND "receivables"."written_off_amount" between 1 and "receivables"."amount")),
	CONSTRAINT "receivables_version_check" CHECK ("receivables"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_scope_idx" ON "contacts" USING btree ("ledger_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_scope_idx" ON "receivable_payments" USING btree ("ledger_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_transaction_idx" ON "receivable_payments" USING btree ("ledger_id","transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receivables_scope_idx" ON "receivables" USING btree ("ledger_id","id");--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "receivable_payment_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "receivable_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_events" ADD CONSTRAINT "receivable_events_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_events" ADD CONSTRAINT "receivable_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_events" ADD CONSTRAINT "events_contact_fk" FOREIGN KEY ("ledger_id","contact_id") REFERENCES "public"."contacts"("ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_events" ADD CONSTRAINT "events_receivable_fk" FOREIGN KEY ("ledger_id","receivable_id") REFERENCES "public"."receivables"("ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_events" ADD CONSTRAINT "events_payment_fk" FOREIGN KEY ("ledger_id","payment_id") REFERENCES "public"."receivable_payments"("ledger_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "receivable_events" ADD CONSTRAINT "events_transaction_fk" FOREIGN KEY ("ledger_id","transaction_id") REFERENCES "public"."transactions"("ledger_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "payments_receivable_fk" FOREIGN KEY ("ledger_id","receivable_id") REFERENCES "public"."receivables"("ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "payments_transaction_fk" FOREIGN KEY ("ledger_id","transaction_id") REFERENCES "public"."transactions"("ledger_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_contact_fk" FOREIGN KEY ("ledger_id","contact_id") REFERENCES "public"."contacts"("ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_contact_idx" ON "receivable_events" USING btree ("ledger_id","contact_id","id");--> statement-breakpoint
CREATE INDEX "payments_receivable_idx" ON "receivable_payments" USING btree ("ledger_id","receivable_id","id");--> statement-breakpoint
CREATE INDEX "receivables_contact_idx" ON "receivables" USING btree ("ledger_id","contact_id","id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_scoped_payment_fk" FOREIGN KEY ("ledger_id","receivable_payment_id") REFERENCES "public"."receivable_payments"("ledger_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_scoped_receivable_fk" FOREIGN KEY ("ledger_id","receivable_id") REFERENCES "public"."receivables"("ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_payment_idx" ON "transactions" USING btree ("ledger_id","receivable_payment_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payment_check" CHECK (("transactions"."receivable_payment_id" IS NULL AND "transactions"."receivable_id" IS NULL) OR ("transactions"."receivable_payment_id" IS NOT NULL AND "transactions"."receivable_id" IS NOT NULL AND "transactions"."kind"='income' AND "transactions"."status"='cleared' AND NOT "transactions"."is_split" AND "transactions"."transfer_id" IS NULL));
--> statement-breakpoint
CREATE FUNCTION ledgerline_check_receivable(book uuid, service_id uuid) RETURNS void LANGUAGE plpgsql AS $$
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
       t.amount <> p.amount OR t.currency <> p.currency OR t.kind <> 'income' OR t.status <> 'cleared' OR t.is_split OR t.transfer_id IS NOT NULL OR
       t.version <> p.version OR t.deleted_at IS DISTINCT FROM p.deleted_at)
  ) OR EXISTS (
    SELECT 1 FROM transactions t LEFT JOIN receivable_payments p ON p.ledger_id=t.ledger_id AND p.id=t.receivable_payment_id
    WHERE t.ledger_id=book AND t.receivable_id=service_id AND
      (p.id IS NULL OR p.transaction_id IS DISTINCT FROM t.id OR p.receivable_id IS DISTINCT FROM t.receivable_id)
  ) THEN RAISE EXCEPTION 'Invalid linked income' USING ERRCODE='23514'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION ledgerline_receivable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='receivables' THEN
    IF TG_OP <> 'INSERT' THEN PERFORM ledgerline_check_receivable(OLD.ledger_id,OLD.id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM ledgerline_check_receivable(NEW.ledger_id,NEW.id); END IF;
  ELSE
    IF TG_OP <> 'INSERT' AND OLD.receivable_id IS NOT NULL THEN PERFORM ledgerline_check_receivable(OLD.ledger_id,OLD.receivable_id); END IF;
    IF TG_OP <> 'DELETE' AND NEW.receivable_id IS NOT NULL THEN PERFORM ledgerline_check_receivable(NEW.ledger_id,NEW.receivable_id); END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER receivables_integrity AFTER INSERT OR UPDATE OR DELETE ON receivables DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledgerline_receivable_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payments_integrity AFTER INSERT OR UPDATE OR DELETE ON receivable_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledgerline_receivable_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER linked_income_integrity AFTER INSERT OR UPDATE OR DELETE ON transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledgerline_receivable_guard();
