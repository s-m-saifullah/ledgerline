CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tags_name_check" CHECK (char_length(btrim("tags"."name")) BETWEEN 1 AND 40 AND strpos("tags"."name", ',') = 0 AND strpos("tags"."name", chr(59)) = 0 AND "tags"."name" !~ '[[:cntrl:]]'),
	CONSTRAINT "tags_version_check" CHECK ("tags"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "transaction_tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tags_ledger_id_id_idx" ON "tags" USING btree ("ledger_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tags_ledger_name_idx" ON "tags" USING btree ("ledger_id",lower(btrim("name"))) WHERE "tags"."deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_scoped_transaction_fk" FOREIGN KEY ("ledger_id","transaction_id") REFERENCES "public"."transactions"("ledger_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_scoped_tag_fk" FOREIGN KEY ("ledger_id","tag_id") REFERENCES "public"."tags"("ledger_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_tags_live_idx" ON "transaction_tags" USING btree ("ledger_id","transaction_id","tag_id") WHERE "transaction_tags"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "transaction_tags_tag_idx" ON "transaction_tags" USING btree ("ledger_id","tag_id") WHERE "transaction_tags"."deleted_at" IS NULL;
