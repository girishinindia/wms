-- HAND-EXTENDED. The sequence and DEFAULT at the bottom are not
-- something drizzle-kit generates; everything above it is.
--
-- Why the five columns become nullable: a self-registering importer
-- supplies a company name, a contact and a mobile number. The legal
-- name, entity type and registered address arrive with the KYC
-- documents days later. Demanding them at signup produces either a form
-- nobody finishes or five placeholder values indistinguishable from
-- real ones. `importer_complete_before_active` is what keeps that safe:
-- a PENDING importer may be incomplete, an ACTIVE one may not.
--
-- users.signup_company_name goes: the company name belongs on
-- `importer.company_name`. That column only existed because the importer
-- row could not be created at signup, which is the constraint this
-- migration removes.

ALTER TABLE "wms"."importer" ALTER COLUMN "legal_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "wms"."importer" ALTER COLUMN "entity_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "wms"."importer" ALTER COLUMN "address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "wms"."importer" ALTER COLUMN "city_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "wms"."importer" ALTER COLUMN "pincode" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "wms"."users" DROP COLUMN "signup_company_name";--> statement-breakpoint
ALTER TABLE "wms"."importer" ADD CONSTRAINT "importer_complete_before_active" CHECK ((status = 'PENDING'::wms.record_status) OR (legal_name IS NOT NULL AND entity_type IS NOT NULL AND address IS NOT NULL AND city_id IS NOT NULL AND pincode IS NOT NULL));
--> statement-breakpoint
-- `code` is NOT NULL UNIQUE, so registration needs a value it cannot
-- collide on. Its own sequence, not the identity one — sharing that
-- would tie the visible customer code to the primary key and desync the
-- moment a row is inserted any other way.
-- The DEFAULT that uses it is 0005, which drizzle-kit generates from
-- schema.ts. Split deliberately: the sequence has to exist first, and
-- only the sequence is beyond what drizzle can express.
CREATE SEQUENCE IF NOT EXISTS "wms"."importer_code_seq" AS bigint START WITH 1 INCREMENT BY 1;
