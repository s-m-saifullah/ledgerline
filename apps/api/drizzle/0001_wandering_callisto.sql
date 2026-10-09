CREATE TABLE "write_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "write_receipts_key_check" CHECK ("write_receipts"."key" ~ '^[A-Za-z0-9._:-]{8,128}$'),
	CONSTRAINT "write_receipts_hash_check" CHECK ("write_receipts"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "write_receipts_status_check" CHECK ("write_receipts"."response_status" BETWEEN 200 AND 299)
);
--> statement-breakpoint
ALTER TABLE "write_receipts" ADD CONSTRAINT "write_receipts_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_receipts" ADD CONSTRAINT "write_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "write_receipts_scope_key_idx" ON "write_receipts" USING btree ("actor_id","ledger_id","key");