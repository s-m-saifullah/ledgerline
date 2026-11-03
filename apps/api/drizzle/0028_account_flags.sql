ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
-- The account the server was set up with (the earliest live one) becomes the admin (ADR 0048). A new database has no
-- account yet; starting the API gives the first one the flag.
UPDATE "users" SET "is_admin" = true WHERE "id" = (SELECT "id" FROM "users" WHERE "deleted_at" IS NULL ORDER BY "created_at", "id" LIMIT 1);
