CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"kind" text DEFAULT 'expense' NOT NULL,
	"month" date NOT NULL,
	"amount" bigint NOT NULL,
	"rollover" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "budgets_kind_check" CHECK ("budgets"."kind" = 'expense'),
	CONSTRAINT "budgets_month_check" CHECK (extract(day from "budgets"."month") = 1),
	CONSTRAINT "budgets_amount_check" CHECK ("budgets"."amount" between 0 and 9007199254740991),
	CONSTRAINT "budgets_version_check" CHECK ("budgets"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_scoped_category_fk" FOREIGN KEY ("ledger_id","kind","category_id") REFERENCES "public"."categories"("ledger_id","kind","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_category_month_idx" ON "budgets" USING btree ("ledger_id","category_id","month") WHERE "budgets"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "budgets_ledger_month_idx" ON "budgets" USING btree ("ledger_id","month");