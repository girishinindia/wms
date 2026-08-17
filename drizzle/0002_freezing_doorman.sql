-- HAND-CORRECTED. Do not regenerate this file.
--
-- drizzle-kit cannot express NULLS NOT DISTINCT, so it emitted
-- user_role_assignment_uk and notification_rule_uk without it. Applying
-- that version would have silently allowed a second PLATFORM role
-- assignment for the same user (warehouse_id and importer_id both NULL
-- compare as distinct without the clause). Both clauses are restored
-- below.
--
-- It also dropped `DESC NULLS FIRST` from notification_feed_idx, which
-- is the whole point of that index — the bell icon reads newest first.
-- Restored too. Verified byte-identical to the live definitions
-- afterwards.
--
-- This migration is already reflected in the database. Record it with
-- `npm run db:baseline -- --apply`; do not run it.

DROP INDEX "wms"."importer_kyc_queue_idx";--> statement-breakpoint
DROP INDEX "wms"."notif_delivery_worker_idx";--> statement-breakpoint
DROP INDEX "wms"."notification_feed_idx";--> statement-breakpoint
DROP INDEX "wms"."notification_rule_uk";--> statement-breakpoint
DROP INDEX "wms"."permission_override_uk";--> statement-breakpoint
DROP INDEX "wms"."ura_role_importer_idx";--> statement-breakpoint
DROP INDEX "wms"."user_role_assignment_uk";--> statement-breakpoint
CREATE INDEX "importer_kyc_queue_idx" ON "wms"."importer" USING btree ("kyc_status" text_ops,"created_at" timestamptz_ops) WHERE ((deleted_at IS NULL) AND (kyc_status = ANY (ARRAY['SUBMITTED'::text, 'UNDER_REVIEW'::text])));--> statement-breakpoint
CREATE INDEX "notif_delivery_worker_idx" ON "wms"."notification_delivery" USING btree ("scheduled_for" timestamptz_ops,"channel" enum_ops) WHERE (status = ANY (ARRAY['PENDING'::wms.delivery_status, 'QUEUED'::wms.delivery_status]));--> statement-breakpoint
CREATE INDEX "notification_feed_idx" ON "wms"."notification" USING btree ("recipient_user_id" int8_ops,"created_at" timestamptz_ops DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "notification_rule_uk" ON "wms"."notification_rule" USING btree ("event_key" text_ops,"audience" enum_ops,"role_filter" enum_ops) NULLS NOT DISTINCT;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_override_uk" ON "wms"."permission_override" USING btree ("user_id" int8_ops,"permission" text_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "ura_role_importer_idx" ON "wms"."user_role_assignment" USING btree ("role" enum_ops,"importer_id" int8_ops) WHERE ((revoked_at IS NULL) AND (importer_id IS NOT NULL));--> statement-breakpoint
CREATE UNIQUE INDEX "user_role_assignment_uk" ON "wms"."user_role_assignment" USING btree ("user_id" int8_ops,"role" enum_ops,"warehouse_id" int8_ops,"importer_id" int8_ops) NULLS NOT DISTINCT WHERE (revoked_at IS NULL);