CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"icon" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "categories_name_check" CHECK (char_length(btrim("categories"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "categories_kind_check" CHECK ("categories"."kind" IN ('income', 'expense')),
	CONSTRAINT "categories_parent_check" CHECK ("categories"."parent_id" IS NULL OR "categories"."parent_id" <> "categories"."id"),
	CONSTRAINT "categories_icon_check" CHECK ("categories"."icon" IS NULL OR "categories"."icon" ~ '^[a-z][a-z0-9-]{0,49}$'),
	CONSTRAINT "categories_color_check" CHECK ("categories"."color" IS NULL OR "categories"."color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "categories_order_check" CHECK ("categories"."sort_order" >= 0),
	CONSTRAINT "categories_version_check" CHECK ("categories"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The composite self-reference needs this unique index to exist first.
CREATE UNIQUE INDEX "categories_scope_kind_id_idx" ON "categories" USING btree ("ledger_id","kind","id");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_scoped_parent_fk" FOREIGN KEY ("ledger_id","kind","parent_id") REFERENCES "public"."categories"("ledger_id","kind","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_ledger_id_idx" ON "categories" USING btree ("ledger_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_root_name_idx" ON "categories" USING btree ("ledger_id","kind",lower(btrim("name"))) WHERE "categories"."parent_id" IS NULL AND "categories"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_child_name_idx" ON "categories" USING btree ("ledger_id","kind","parent_id",lower(btrim("name"))) WHERE "categories"."parent_id" IS NOT NULL AND "categories"."deleted_at" IS NULL;