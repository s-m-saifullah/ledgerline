CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"account_id" uuid NOT NULL,
	"to_account_id" uuid,
	"category_id" uuid,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"received_amount" bigint,
	"received_currency" text,
	"bonus_amount" bigint,
	"bonus_currency" text,
	"bonus_category_id" uuid,
	"payee" text,
	"note" text,
	"frequency" text NOT NULL,
	"interval" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"next_date" date,
	"paused_at" timestamp with time zone,
	"paused_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "recurring_rules_title_check" CHECK (char_length("recurring_rules"."title") BETWEEN 1 AND 80),
	CONSTRAINT "recurring_rules_amount_check" CHECK (abs("recurring_rules"."amount") BETWEEN 1 AND 9007199254740991 AND (("recurring_rules"."kind" = 'expense' AND "recurring_rules"."amount" < 0) OR ("recurring_rules"."kind" <> 'expense' AND "recurring_rules"."amount" > 0))),
	CONSTRAINT "recurring_rules_currency_check" CHECK ("recurring_rules"."currency" ~ '^[A-Z]{3}$' AND ("recurring_rules"."received_currency" IS NULL OR "recurring_rules"."received_currency" ~ '^[A-Z]{3}$') AND ("recurring_rules"."bonus_currency" IS NULL OR "recurring_rules"."bonus_currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "recurring_rules_transfer_check" CHECK (("recurring_rules"."kind" = 'transfer') = ("recurring_rules"."to_account_id" IS NOT NULL) AND ("recurring_rules"."kind" <> 'transfer' OR ("recurring_rules"."category_id" IS NULL AND "recurring_rules"."payee" IS NULL AND "recurring_rules"."to_account_id" <> "recurring_rules"."account_id")) AND ("recurring_rules"."kind" = 'transfer' OR ("recurring_rules"."received_amount" IS NULL AND "recurring_rules"."bonus_amount" IS NULL))),
	CONSTRAINT "recurring_rules_extras_check" CHECK ((("recurring_rules"."received_amount" IS NULL) = ("recurring_rules"."received_currency" IS NULL)) AND ("recurring_rules"."received_amount" IS NULL OR "recurring_rules"."received_amount" > 0) AND (("recurring_rules"."bonus_amount" IS NULL) = ("recurring_rules"."bonus_currency" IS NULL) AND ("recurring_rules"."bonus_amount" IS NULL) = ("recurring_rules"."bonus_category_id" IS NULL)) AND ("recurring_rules"."bonus_amount" IS NULL OR "recurring_rules"."bonus_amount" > 0)),
	CONSTRAINT "recurring_rules_schedule_check" CHECK ("recurring_rules"."interval" BETWEEN 1 AND 365 AND ("recurring_rules"."end_date" IS NULL OR "recurring_rules"."end_date" >= "recurring_rules"."start_date") AND ("recurring_rules"."next_date" IS NULL OR "recurring_rules"."next_date" >= "recurring_rules"."start_date")),
	CONSTRAINT "recurring_rules_pause_check" CHECK (("recurring_rules"."paused_at" IS NULL) = ("recurring_rules"."paused_reason" IS NULL)),
	CONSTRAINT "recurring_rules_version_check" CHECK ("recurring_rules"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "recurring_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"occurrence_date" date NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"transaction_id" uuid,
	"transfer_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "recurring_runs_state_check" CHECK (("recurring_runs"."status" = 'created' AND ("recurring_runs"."transaction_id" IS NOT NULL)) OR ("recurring_runs"."status" <> 'created' AND "recurring_runs"."transaction_id" IS NULL AND "recurring_runs"."transfer_id" IS NULL)),
	CONSTRAINT "recurring_runs_reason_check" CHECK (("recurring_runs"."status" = 'attention') = ("recurring_runs"."reason" IS NOT NULL)),
	CONSTRAINT "recurring_runs_version_check" CHECK ("recurring_runs"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_rules_scope_id_idx" ON "recurring_rules" USING btree ("ledger_id","id");
--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_scoped_account_fk" FOREIGN KEY ("ledger_id","account_id") REFERENCES "public"."accounts"("ledger_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_scoped_to_account_fk" FOREIGN KEY ("ledger_id","to_account_id") REFERENCES "public"."accounts"("ledger_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_scoped_category_fk" FOREIGN KEY ("ledger_id","category_id") REFERENCES "public"."categories"("ledger_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_scoped_bonus_category_fk" FOREIGN KEY ("ledger_id","bonus_category_id") REFERENCES "public"."categories"("ledger_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_runs" ADD CONSTRAINT "recurring_runs_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_runs" ADD CONSTRAINT "recurring_runs_scoped_rule_fk" FOREIGN KEY ("ledger_id","rule_id") REFERENCES "public"."recurring_rules"("ledger_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "recurring_rules_ledger_idx" ON "recurring_rules" USING btree ("ledger_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_runs_occurrence_idx" ON "recurring_runs" USING btree ("ledger_id","rule_id","occurrence_date");
--> statement-breakpoint
CREATE INDEX "recurring_runs_status_idx" ON "recurring_runs" USING btree ("ledger_id","status");