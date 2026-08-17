-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE SCHEMA "wms";
--> statement-breakpoint
CREATE TYPE "wms"."access_scope" AS ENUM('NONE', 'OWN', 'WAREHOUSE', 'ALL');--> statement-breakpoint
CREATE TYPE "wms"."audit_operation" AS ENUM('INSERT', 'UPDATE', 'DELETE', 'RESTORE', 'LOGIN', 'LOGOUT', 'DENY', 'EXPORT', 'APPROVE', 'REJECT');--> statement-breakpoint
CREATE TYPE "wms"."audit_result" AS ENUM('SUCCESS', 'DENIED', 'FAILED');--> statement-breakpoint
CREATE TYPE "wms"."creation_scope" AS ENUM('ANY', 'SAME_WAREHOUSE', 'SAME_IMPORTER', 'SELF_REGISTER');--> statement-breakpoint
CREATE TYPE "wms"."delivery_status" AS ENUM('PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SUPPRESSED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "wms"."notif_audience" AS ENUM('ACTOR', 'SUBJECT', 'PARENT', 'ANCESTORS', 'ALL_SUPER_ADMINS', 'ROLE', 'WAREHOUSE_ROLE', 'IMPORTER_ROLE', 'EXPLICIT');--> statement-breakpoint
CREATE TYPE "wms"."notif_channel" AS ENUM('IN_APP', 'EMAIL', 'SMS', 'PUSH', 'WHATSAPP');--> statement-breakpoint
CREATE TYPE "wms"."record_status" AS ENUM('DRAFT', 'PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "wms"."role_domain" AS ENUM('PLATFORM', 'WAREHOUSE', 'IMPORTER');--> statement-breakpoint
CREATE TYPE "wms"."role_key" AS ENUM('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'TRANSPORTER_MANAGER', 'INWARD_MANAGER', 'STORAGE_MANAGER', 'PACKAGE_MANAGER', 'DISPATCH_MANAGER', 'IMPORTER', 'SALES_AGENT');--> statement-breakpoint
CREATE SEQUENCE "wms"."audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "wms"."users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" "citext" NOT NULL,
	"email_verified_at" timestamp with time zone,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"mobile" "wms.mobile_in" NOT NULL,
	"mobile_verified_at" timestamp with time zone,
	"password_hash" text,
	"password_changed_at" timestamp with time zone,
	"photo_url" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"default_role" "wms"."role_key",
	"status" "wms"."record_status" DEFAULT 'ACTIVE' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"last_login_ip" "inet",
	"failed_login_count" smallint DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_by" bigint,
	"path" "ltree",
	"depth" smallint GENERATED ALWAYS AS (nlevel(path)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_by" bigint,
	"deactivated_at" timestamp with time zone,
	"deactivation_reason" text,
	"deleted_by" bigint,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_check" CHECK ((status <> 'SUSPENDED'::wms.record_status) OR (deactivation_reason IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "wms"."user_session" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.user_session_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"active_role" "wms"."role_key",
	"active_warehouse_id" bigint,
	"active_importer_id" bigint,
	"ip" "inet",
	"user_agent" text,
	"device_name" text,
	"platform" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "user_session_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "user_session_check" CHECK (expires_at > issued_at),
	CONSTRAINT "user_session_platform_check" CHECK (platform = ANY (ARRAY['WEB'::text, 'ANDROID'::text, 'IOS'::text]))
);
--> statement-breakpoint
CREATE TABLE "wms"."user_verification_token" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.user_verification_token_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"sent_to" text NOT NULL,
	"channel" text NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet",
	CONSTRAINT "user_verification_token_channel_check" CHECK (channel = ANY (ARRAY['EMAIL'::text, 'SMS'::text])),
	CONSTRAINT "user_verification_token_purpose_check" CHECK (purpose = ANY (ARRAY['EMAIL_VERIFY'::text, 'MOBILE_VERIFY'::text, 'PASSWORD_RESET'::text, 'LOGIN_OTP'::text, 'INVITE'::text]))
);
--> statement-breakpoint
CREATE TABLE "wms"."city" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.city_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"state_id" bigint NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" bigint,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "city_state_id_name_key" UNIQUE("state_id","name")
);
--> statement-breakpoint
CREATE TABLE "wms"."country" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.country_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"iso2" char(2) NOT NULL,
	"iso3" char(3) NOT NULL,
	"name" text NOT NULL,
	"phone_code" varchar(6) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" bigint,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "country_iso2_key" UNIQUE("iso2"),
	CONSTRAINT "country_iso3_key" UNIQUE("iso3")
);
--> statement-breakpoint
CREATE TABLE "wms"."state" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.state_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"country_id" bigint NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" bigint,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "state_country_id_code_key" UNIQUE("country_id","code")
);
--> statement-breakpoint
CREATE TABLE "wms"."warehouse_type" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.warehouse_type_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" bigint,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "warehouse_type_code_key" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "wms"."vehicle_type" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.vehicle_type_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"axle_count" smallint,
	"capacity_kg" numeric(10, 2),
	"capacity_cbm" numeric(10, 2),
	"length_ft" numeric(6, 2),
	"width_ft" numeric(6, 2),
	"height_ft" numeric(6, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" bigint,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "vehicle_type_code_key" UNIQUE("code"),
	CONSTRAINT "vehicle_type_category_check" CHECK (category = ANY (ARRAY['THREE_WHEELER'::text, 'LCV'::text, 'MCV'::text, 'HCV'::text, 'TRAILER'::text, 'CONTAINER'::text]))
);
--> statement-breakpoint
CREATE TABLE "wms"."warehouse" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.warehouse_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"warehouse_type_id" bigint NOT NULL,
	"address" text NOT NULL,
	"landmark" text,
	"area" text,
	"city_id" bigint NOT NULL,
	"pincode" "wms.pincode_in" NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"gmap_url" text,
	"total_area_sqft" numeric(12, 2),
	"usable_area_sqft" numeric(12, 2),
	"storage_capacity_cbm" numeric(12, 2),
	"pallet_positions" integer,
	"dock_count" smallint,
	"max_vehicle_length_ft" numeric(6, 2),
	"floor_count" smallint,
	"has_racking" boolean DEFAULT true NOT NULL,
	"has_cctv" boolean DEFAULT false NOT NULL,
	"has_weighbridge" boolean DEFAULT false NOT NULL,
	"contact_person" text,
	"contact_mobile" "wms.mobile_in",
	"alternate_mobile" "wms.mobile_in",
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" bigint,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "warehouse_code_key" UNIQUE("code"),
	CONSTRAINT "warehouse_check" CHECK ((usable_area_sqft IS NULL) OR (total_area_sqft IS NULL) OR (usable_area_sqft <= total_area_sqft))
);
--> statement-breakpoint
CREATE TABLE "wms"."importer" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.importer_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"company_name" text NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"entity_type" text NOT NULL,
	"address" text NOT NULL,
	"landmark" text,
	"area" text,
	"city_id" bigint NOT NULL,
	"pincode" "wms.pincode_in" NOT NULL,
	"gstin" "wms.gstin",
	"pan" "wms.pan_no",
	"contact_person" text NOT NULL,
	"contact_email" "citext" NOT NULL,
	"contact_mobile" "wms.mobile_in" NOT NULL,
	"alternate_mobile" "wms.mobile_in",
	"credit_limit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"credit_days" smallint DEFAULT 0 NOT NULL,
	"payment_terms" text,
	"currency_code" char(3) DEFAULT 'INR' NOT NULL,
	"billing_cycle" text DEFAULT 'MONTHLY' NOT NULL,
	"is_credit_blocked" boolean DEFAULT false NOT NULL,
	"credit_block_reason" text,
	"origin" text NOT NULL,
	"status" "wms"."record_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"kyc_submitted_at" timestamp with time zone,
	"approved_by" bigint,
	"approved_at" timestamp with time zone,
	"rejected_by" bigint,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"suspended_reason" text,
	"notes" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" bigint,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "importer_code_key" UNIQUE("code"),
	CONSTRAINT "importer_billing_cycle_check" CHECK (billing_cycle = ANY (ARRAY['WEEKLY'::text, 'FORTNIGHTLY'::text, 'MONTHLY'::text, 'PER_TRANSACTION'::text])),
	CONSTRAINT "importer_check" CHECK (((origin = 'SELF_REGISTERED'::text) AND (created_by IS NULL)) OR ((origin = 'CREATED_BY_ADMIN'::text) AND (created_by IS NOT NULL))),
	CONSTRAINT "importer_check1" CHECK ((status <> 'REJECTED'::wms.record_status) OR (rejection_reason IS NOT NULL)),
	CONSTRAINT "importer_check2" CHECK ((NOT is_credit_blocked) OR (credit_block_reason IS NOT NULL)),
	CONSTRAINT "importer_entity_type_check" CHECK (entity_type = ANY (ARRAY['PROPRIETORSHIP'::text, 'PARTNERSHIP'::text, 'LLP'::text, 'PRIVATE_LIMITED'::text, 'PUBLIC_LIMITED'::text, 'HUF'::text, 'TRUST'::text, 'SOCIETY'::text, 'GOVERNMENT'::text])),
	CONSTRAINT "importer_kyc_status_check" CHECK (kyc_status = ANY (ARRAY['NOT_STARTED'::text, 'SUBMITTED'::text, 'UNDER_REVIEW'::text, 'VERIFIED'::text, 'REJECTED'::text])),
	CONSTRAINT "importer_origin_check" CHECK (origin = ANY (ARRAY['SELF_REGISTERED'::text, 'CREATED_BY_ADMIN'::text]))
);
--> statement-breakpoint
CREATE TABLE "wms"."importer_client" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.importer_client_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"importer_id" bigint NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"legal_name" text,
	"gstin" "wms.gstin",
	"contact_person" text,
	"contact_mobile" "wms.mobile_in" NOT NULL,
	"contact_email" "citext",
	"address" text,
	"landmark" text,
	"city_id" bigint,
	"pincode" "wms.pincode_in",
	"status" "wms"."record_status" DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" bigint,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "importer_client_importer_id_code_key" UNIQUE("importer_id","code")
);
--> statement-breakpoint
CREATE TABLE "wms"."sales_agent_client" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.sales_agent_client_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"agent_user_id" bigint NOT NULL,
	"client_id" bigint NOT NULL,
	"assigned_by" bigint NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" bigint,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wms"."transporter" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.transporter_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"gstin" "wms.gstin",
	"pan" "wms.pan_no",
	"contact_person" text NOT NULL,
	"contact_mobile" "wms.mobile_in" NOT NULL,
	"alternate_mobile" "wms.mobile_in",
	"contact_email" "citext",
	"office_phone" varchar(15),
	"website" text,
	"address" text,
	"city_id" bigint,
	"pincode" "wms.pincode_in",
	"status" "wms"."record_status" DEFAULT 'ACTIVE' NOT NULL,
	"blacklisted" boolean DEFAULT false NOT NULL,
	"blacklist_reason" text,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" bigint,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "transporter_code_key" UNIQUE("code"),
	CONSTRAINT "transporter_check" CHECK ((NOT blacklisted) OR (blacklist_reason IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "wms"."vehicle" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.vehicle_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"transporter_id" bigint NOT NULL,
	"vehicle_type_id" bigint NOT NULL,
	"registration_number" "wms.vehicle_reg" NOT NULL,
	"chassis_number" varchar(25),
	"engine_number" varchar(25),
	"model" text,
	"fuel_type" text,
	"capacity_kg" numeric(10, 2),
	"capacity_cbm" numeric(10, 2),
	"length_ft" numeric(6, 2),
	"width_ft" numeric(6, 2),
	"height_ft" numeric(6, 2),
	"axle_count" smallint,
	"status" "wms"."record_status" DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" bigint,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "vehicle_fuel_type_check" CHECK (fuel_type = ANY (ARRAY['DIESEL'::text, 'PETROL'::text, 'CNG'::text, 'LNG'::text, 'ELECTRIC'::text, 'HYBRID'::text]))
);
--> statement-breakpoint
CREATE TABLE "wms"."role" (
	"key" "wms"."role_key" PRIMARY KEY NOT NULL,
	"domain" "wms"."role_domain" NOT NULL,
	"name" text NOT NULL,
	"level" smallint NOT NULL,
	"is_protected" boolean DEFAULT false NOT NULL,
	"is_exclusive" boolean DEFAULT false NOT NULL,
	"is_immutable" boolean DEFAULT false NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms"."permission" (
	"key" text PRIMARY KEY NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"module" text NOT NULL,
	"is_dangerous" boolean DEFAULT false NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "permission_action_check" CHECK (action = ANY (ARRAY['create'::text, 'read'::text, 'update'::text, 'delete'::text, 'approve'::text, 'export'::text, 'assign'::text]))
);
--> statement-breakpoint
CREATE TABLE "wms"."role_creation_rule" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.role_creation_rule_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_role" "wms"."role_key",
	"target_role" "wms"."role_key" NOT NULL,
	"scope" "wms"."creation_scope" NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "wms"."user_role_assignment" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.user_role_assignment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"role" "wms"."role_key" NOT NULL,
	"role_domain" "wms"."role_domain" NOT NULL,
	"warehouse_id" bigint,
	"importer_id" bigint,
	"assigned_by" bigint,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" bigint,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"note" text,
	CONSTRAINT "user_role_assignment_check" CHECK (CHECK (
CASE role_domain
    WHEN 'PLATFORM'::wms.role_domain THEN ((warehouse_id IS NULL) AND (importer_id IS NULL))
    WHEN 'WAREHOUSE'::wms.role_domain THEN ((warehouse_id IS NOT NULL) AND (importer_id IS NULL))
    WHEN 'IMPORTER'::wms.role_domain THEN ((importer_id IS NOT NULL) AND (warehouse_id IS NULL))
    ELSE NULL::boolean
END)),
	CONSTRAINT "user_role_assignment_check1" CHECK ((revoked_at IS NULL) OR (revoke_reason IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "wms"."permission_override" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.permission_override_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"permission" text NOT NULL,
	"effect" text DEFAULT 'DENY' NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "permission_override_effect_check" CHECK (effect = 'DENY'::text)
);
--> statement-breakpoint
CREATE TABLE "wms"."notification_event" (
	"key" text PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"payload_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_priority" smallint DEFAULT 5 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms"."notification_template" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.notification_template_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_key" text NOT NULL,
	"channel" "wms"."notif_channel" NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"version" smallint DEFAULT 1 NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"action_url" text,
	"dlt_template_id" text,
	"dlt_entity_id" text,
	"sender_id" varchar(11),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_template_event_key_channel_locale_version_key" UNIQUE("event_key","channel","locale","version"),
	CONSTRAINT "notification_template_check" CHECK ((channel <> 'SMS'::wms.notif_channel) OR (dlt_template_id IS NOT NULL)),
	CONSTRAINT "notification_template_check1" CHECK ((channel <> 'EMAIL'::wms.notif_channel) OR (subject IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "wms"."notification" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.notification_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_key" text NOT NULL,
	"rule_id" bigint,
	"recipient_user_id" bigint NOT NULL,
	"actor_user_id" bigint,
	"entity_type" text,
	"entity_id" text,
	"warehouse_id" bigint,
	"importer_id" bigint,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"action_url" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" smallint DEFAULT 5 NOT NULL,
	"correlation_id" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "notification_priority_check" CHECK ((priority >= 1) AND (priority <= 9))
);
--> statement-breakpoint
CREATE TABLE "wms"."notification_rule" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.notification_rule_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_key" text NOT NULL,
	"audience" "wms"."notif_audience" NOT NULL,
	"role_filter" "wms"."role_key",
	"channels" "wms.notif_channel"[] DEFAULT '{"IN_APP"}' NOT NULL,
	"is_mandatory" boolean DEFAULT false NOT NULL,
	"condition" jsonb,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_rule_channels_check" CHECK (array_length(channels, 1) > 0),
	CONSTRAINT "notification_rule_check" CHECK ((audience <> ALL (ARRAY['ROLE'::wms.notif_audience, 'WAREHOUSE_ROLE'::wms.notif_audience, 'IMPORTER_ROLE'::wms.notif_audience])) OR (role_filter IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "wms"."notification_quiet_hours" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"start_time" time DEFAULT '22:00:00' NOT NULL,
	"end_time" time DEFAULT '07:00:00' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"applies_to" "wms.notif_channel"[] DEFAULT '{"SMS","PUSH"}' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms"."notification_delivery" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.notification_delivery_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"notification_id" bigint NOT NULL,
	"channel" "wms"."notif_channel" NOT NULL,
	"address" text NOT NULL,
	"status" "wms"."delivery_status" DEFAULT 'PENDING' NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"provider_response" jsonb,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint DEFAULT 3 NOT NULL,
	"last_error" text,
	"error_code" text,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"next_retry_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"cost_paise" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms"."user_device" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wms"."wms.user_device_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"platform" text NOT NULL,
	"push_token" text NOT NULL,
	"device_model" text,
	"os_version" text,
	"app_version" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_device_platform_check" CHECK (platform = ANY (ARRAY['ANDROID'::text, 'IOS'::text, 'WEB'::text]))
);
--> statement-breakpoint
CREATE TABLE "wms"."role_permission" (
	"role" "wms"."role_key" NOT NULL,
	"permission" text NOT NULL,
	"scope" "wms"."access_scope" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permission_pkey" PRIMARY KEY("role","permission"),
	CONSTRAINT "role_permission_scope_check" CHECK (scope <> 'NONE'::wms.access_scope)
);
--> statement-breakpoint
CREATE TABLE "wms"."notification_preference" (
	"user_id" bigint NOT NULL,
	"event_key" text NOT NULL,
	"channel" "wms"."notif_channel" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_pkey" PRIMARY KEY("user_id","event_key","channel")
);
--> statement-breakpoint
CREATE TABLE "wms"."warehouse_transporter" (
	"warehouse_id" bigint NOT NULL,
	"transporter_id" bigint NOT NULL,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"contract_ref" text,
	"contract_start" date,
	"contract_end" date,
	"approved_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "warehouse_transporter_pkey" PRIMARY KEY("warehouse_id","transporter_id")
);
--> statement-breakpoint
ALTER TABLE "wms"."users" ADD CONSTRAINT "users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."users" ADD CONSTRAINT "users_deactivated_by_fkey" FOREIGN KEY ("deactivated_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."users" ADD CONSTRAINT "users_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."users" ADD CONSTRAINT "users_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."user_session" ADD CONSTRAINT "user_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "wms"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."user_verification_token" ADD CONSTRAINT "user_verification_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "wms"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."city" ADD CONSTRAINT "city_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."city" ADD CONSTRAINT "city_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."city" ADD CONSTRAINT "city_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "wms"."state"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."city" ADD CONSTRAINT "city_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."country" ADD CONSTRAINT "country_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."country" ADD CONSTRAINT "country_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."country" ADD CONSTRAINT "country_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."state" ADD CONSTRAINT "state_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "wms"."country"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."state" ADD CONSTRAINT "state_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."state" ADD CONSTRAINT "state_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."state" ADD CONSTRAINT "state_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."warehouse_type" ADD CONSTRAINT "warehouse_type_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."warehouse_type" ADD CONSTRAINT "warehouse_type_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."warehouse_type" ADD CONSTRAINT "warehouse_type_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."vehicle_type" ADD CONSTRAINT "vehicle_type_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."vehicle_type" ADD CONSTRAINT "vehicle_type_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."vehicle_type" ADD CONSTRAINT "vehicle_type_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."warehouse" ADD CONSTRAINT "warehouse_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "wms"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."warehouse" ADD CONSTRAINT "warehouse_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."warehouse" ADD CONSTRAINT "warehouse_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."warehouse" ADD CONSTRAINT "warehouse_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."warehouse" ADD CONSTRAINT "warehouse_warehouse_type_id_fkey" FOREIGN KEY ("warehouse_type_id") REFERENCES "wms"."warehouse_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."importer" ADD CONSTRAINT "importer_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."importer" ADD CONSTRAINT "importer_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "wms"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."importer" ADD CONSTRAINT "importer_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."importer" ADD CONSTRAINT "importer_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."importer" ADD CONSTRAINT "importer_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."importer" ADD CONSTRAINT "importer_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."importer_client" ADD CONSTRAINT "importer_client_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "wms"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."importer_client" ADD CONSTRAINT "importer_client_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."importer_client" ADD CONSTRAINT "importer_client_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."importer_client" ADD CONSTRAINT "importer_client_importer_id_fkey" FOREIGN KEY ("importer_id") REFERENCES "wms"."importer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."importer_client" ADD CONSTRAINT "importer_client_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."sales_agent_client" ADD CONSTRAINT "sales_agent_client_agent_user_id_fkey" FOREIGN KEY ("agent_user_id") REFERENCES "wms"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."sales_agent_client" ADD CONSTRAINT "sales_agent_client_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."sales_agent_client" ADD CONSTRAINT "sales_agent_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "wms"."importer_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."sales_agent_client" ADD CONSTRAINT "sales_agent_client_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."transporter" ADD CONSTRAINT "transporter_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "wms"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."transporter" ADD CONSTRAINT "transporter_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."transporter" ADD CONSTRAINT "transporter_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."transporter" ADD CONSTRAINT "transporter_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."vehicle" ADD CONSTRAINT "vehicle_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."vehicle" ADD CONSTRAINT "vehicle_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."vehicle" ADD CONSTRAINT "vehicle_transporter_id_fkey" FOREIGN KEY ("transporter_id") REFERENCES "wms"."transporter"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."vehicle" ADD CONSTRAINT "vehicle_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."vehicle" ADD CONSTRAINT "vehicle_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "wms"."vehicle_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."role_creation_rule" ADD CONSTRAINT "role_creation_rule_actor_role_fkey" FOREIGN KEY ("actor_role") REFERENCES "wms"."role"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."role_creation_rule" ADD CONSTRAINT "role_creation_rule_target_role_fkey" FOREIGN KEY ("target_role") REFERENCES "wms"."role"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."user_role_assignment" ADD CONSTRAINT "user_role_assignment_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."user_role_assignment" ADD CONSTRAINT "user_role_assignment_importer_id_fkey" FOREIGN KEY ("importer_id") REFERENCES "wms"."importer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."user_role_assignment" ADD CONSTRAINT "user_role_assignment_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."user_role_assignment" ADD CONSTRAINT "user_role_assignment_role_role_domain_fkey" FOREIGN KEY ("role","role_domain") REFERENCES "wms"."role"("key","domain") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."user_role_assignment" ADD CONSTRAINT "user_role_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "wms"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."user_role_assignment" ADD CONSTRAINT "user_role_assignment_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "wms"."warehouse"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."permission_override" ADD CONSTRAINT "permission_override_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."permission_override" ADD CONSTRAINT "permission_override_permission_fkey" FOREIGN KEY ("permission") REFERENCES "wms"."permission"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."permission_override" ADD CONSTRAINT "permission_override_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "wms"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."notification_template" ADD CONSTRAINT "notification_template_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."notification_template" ADD CONSTRAINT "notification_template_event_key_fkey" FOREIGN KEY ("event_key") REFERENCES "wms"."notification_event"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."notification_template" ADD CONSTRAINT "notification_template_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."notification" ADD CONSTRAINT "notification_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."notification" ADD CONSTRAINT "notification_event_key_fkey" FOREIGN KEY ("event_key") REFERENCES "wms"."notification_event"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."notification" ADD CONSTRAINT "notification_importer_id_fkey" FOREIGN KEY ("importer_id") REFERENCES "wms"."importer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."notification" ADD CONSTRAINT "notification_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "wms"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."notification" ADD CONSTRAINT "notification_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "wms"."notification_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."notification" ADD CONSTRAINT "notification_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "wms"."warehouse"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."notification_rule" ADD CONSTRAINT "notification_rule_event_key_fkey" FOREIGN KEY ("event_key") REFERENCES "wms"."notification_event"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."notification_rule" ADD CONSTRAINT "notification_rule_role_filter_fkey" FOREIGN KEY ("role_filter") REFERENCES "wms"."role"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."notification_quiet_hours" ADD CONSTRAINT "notification_quiet_hours_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "wms"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "wms"."notification"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."user_device" ADD CONSTRAINT "user_device_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "wms"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."role_permission" ADD CONSTRAINT "role_permission_permission_fkey" FOREIGN KEY ("permission") REFERENCES "wms"."permission"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."role_permission" ADD CONSTRAINT "role_permission_role_fkey" FOREIGN KEY ("role") REFERENCES "wms"."role"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."notification_preference" ADD CONSTRAINT "notification_preference_event_key_fkey" FOREIGN KEY ("event_key") REFERENCES "wms"."notification_event"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."notification_preference" ADD CONSTRAINT "notification_preference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "wms"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."warehouse_transporter" ADD CONSTRAINT "warehouse_transporter_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "wms"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."warehouse_transporter" ADD CONSTRAINT "warehouse_transporter_transporter_id_fkey" FOREIGN KEY ("transporter_id") REFERENCES "wms"."transporter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms"."warehouse_transporter" ADD CONSTRAINT "warehouse_transporter_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "wms"."warehouse"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_created_by_idx" ON "wms"."users" USING btree ("created_by" int8_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uk" ON "wms"."users" USING btree ("email" citext_ops) WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "users_locked_idx" ON "wms"."users" USING btree ("locked_until" timestamptz_ops) WHERE (locked_until IS NOT NULL);--> statement-breakpoint
CREATE INDEX "users_login_idx" ON "wms"."users" USING btree ("email" citext_ops,"password_hash" citext_ops,"status" citext_ops,"locked_until" citext_ops,"failed_login_count" citext_ops) WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "users_mobile_uk" ON "wms"."users" USING btree ("mobile" bpchar_ops) WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "users_name_trgm" ON "wms"."users" USING gin ((((first_name || ' '::text) || last_name)) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_path_gist" ON "wms"."users" USING gist ("path" gist_ltree_ops);--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "wms"."users" USING btree ("status" enum_ops) WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "user_session_cleanup_idx" ON "wms"."user_session" USING btree ("expires_at" timestamptz_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "user_session_expiry_idx" ON "wms"."user_session" USING btree ("expires_at" timestamptz_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "user_session_user_idx" ON "wms"."user_session" USING btree ("user_id" int8_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "user_token_hash_uk" ON "wms"."user_verification_token" USING btree ("token_hash" text_ops);--> statement-breakpoint
CREATE INDEX "user_token_lookup_idx" ON "wms"."user_verification_token" USING btree ("user_id" int8_ops,"purpose" text_ops,"expires_at" timestamptz_ops) WHERE (consumed_at IS NULL);--> statement-breakpoint
CREATE INDEX "city_state_idx" ON "wms"."city" USING btree ("state_id" int8_ops);--> statement-breakpoint
CREATE INDEX "state_country_idx" ON "wms"."state" USING btree ("country_id" int8_ops);--> statement-breakpoint
CREATE INDEX "warehouse_active_idx" ON "wms"."warehouse" USING btree ("is_active" bool_ops) WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "warehouse_city_fk_idx" ON "wms"."warehouse" USING btree ("city_id" int8_ops);--> statement-breakpoint
CREATE INDEX "warehouse_city_idx" ON "wms"."warehouse" USING btree ("city_id" int8_ops) WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "warehouse_created_by_idx" ON "wms"."warehouse" USING btree ("created_by" int8_ops);--> statement-breakpoint
CREATE INDEX "warehouse_name_trgm" ON "wms"."warehouse" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "warehouse_type_fk_idx" ON "wms"."warehouse" USING btree ("warehouse_type_id" int8_ops);--> statement-breakpoint
CREATE INDEX "importer_approved_by_idx" ON "wms"."importer" USING btree ("approved_by" int8_ops) WHERE (approved_by IS NOT NULL);--> statement-breakpoint
CREATE INDEX "importer_city_fk_idx" ON "wms"."importer" USING btree ("city_id" int8_ops);--> statement-breakpoint
CREATE INDEX "importer_created_by_idx" ON "wms"."importer" USING btree ("created_by" int8_ops) WHERE (created_by IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "importer_gstin_uk" ON "wms"."importer" USING btree ("gstin" bpchar_ops) WHERE ((gstin IS NOT NULL) AND (deleted_at IS NULL));--> statement-breakpoint
CREATE INDEX "importer_kyc_idx" ON "wms"."importer" USING btree ("kyc_status" text_ops) WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "importer_kyc_queue_idx" ON "wms"."importer" USING btree ("kyc_status" timestamptz_ops,"created_at" text_ops) WHERE ((deleted_at IS NULL) AND (kyc_status = ANY (ARRAY['SUBMITTED'::text, 'UNDER_REVIEW'::text])));--> statement-breakpoint
CREATE INDEX "importer_name_trgm" ON "wms"."importer" USING gin ("company_name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "importer_pan_uk" ON "wms"."importer" USING btree ("pan" bpchar_ops) WHERE ((pan IS NOT NULL) AND (deleted_at IS NULL));--> statement-breakpoint
CREATE INDEX "importer_pending_idx" ON "wms"."importer" USING btree ("created_at" timestamptz_ops) WHERE ((deleted_at IS NULL) AND (status = 'PENDING'::wms.record_status));--> statement-breakpoint
CREATE INDEX "importer_status_idx" ON "wms"."importer" USING btree ("status" enum_ops) WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "importer_client_city_idx" ON "wms"."importer_client" USING btree ("city_id" int8_ops);--> statement-breakpoint
CREATE INDEX "importer_client_idx" ON "wms"."importer_client" USING btree ("importer_id" int8_ops) WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "importer_client_name_trgm" ON "wms"."importer_client" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agent_client_client_idx" ON "wms"."sales_agent_client" USING btree ("client_id" int8_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "sales_agent_client_uk" ON "wms"."sales_agent_client" USING btree ("agent_user_id" int8_ops,"client_id" int8_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "transporter_city_fk_idx" ON "wms"."transporter" USING btree ("city_id" int8_ops);--> statement-breakpoint
CREATE INDEX "transporter_created_by_idx" ON "wms"."transporter" USING btree ("created_by" int8_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "transporter_gstin_uk" ON "wms"."transporter" USING btree ("gstin" bpchar_ops) WHERE ((gstin IS NOT NULL) AND (deleted_at IS NULL));--> statement-breakpoint
CREATE INDEX "transporter_name_trgm" ON "wms"."transporter" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "transporter_status_idx" ON "wms"."transporter" USING btree ("status" enum_ops) WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "vehicle_active_idx" ON "wms"."vehicle" USING btree ("transporter_id" int8_ops) WHERE ((deleted_at IS NULL) AND (status = 'ACTIVE'::wms.record_status));--> statement-breakpoint
CREATE INDEX "vehicle_created_by_idx" ON "wms"."vehicle" USING btree ("created_by" int8_ops);--> statement-breakpoint
CREATE INDEX "vehicle_reg_trgm" ON "wms"."vehicle" USING gin ("registration_number" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_registration_uk" ON "wms"."vehicle" USING btree ("registration_number" text_ops) WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "vehicle_transporter_idx" ON "wms"."vehicle" USING btree ("transporter_id" int8_ops) WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "vehicle_type_fk_idx" ON "wms"."vehicle" USING btree ("vehicle_type_id" int8_ops);--> statement-breakpoint
CREATE INDEX "permission_resource_idx" ON "wms"."permission" USING btree ("resource" text_ops);--> statement-breakpoint
CREATE INDEX "creation_rule_target_idx" ON "wms"."role_creation_rule" USING btree ("target_role" enum_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "role_creation_rule_uk" ON "wms"."role_creation_rule" USING btree ("actor_role" enum_ops,"target_role" enum_ops);--> statement-breakpoint
CREATE INDEX "ura_assigned_by_idx" ON "wms"."user_role_assignment" USING btree ("assigned_by" int8_ops) WHERE (assigned_by IS NOT NULL);--> statement-breakpoint
CREATE INDEX "ura_importer_idx" ON "wms"."user_role_assignment" USING btree ("importer_id" int8_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "ura_role_idx" ON "wms"."user_role_assignment" USING btree ("role" enum_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "ura_role_importer_idx" ON "wms"."user_role_assignment" USING btree ("role" int8_ops,"importer_id" enum_ops) WHERE ((revoked_at IS NULL) AND (importer_id IS NOT NULL));--> statement-breakpoint
CREATE INDEX "ura_role_warehouse_idx" ON "wms"."user_role_assignment" USING btree ("role" enum_ops,"warehouse_id" int8_ops) WHERE ((revoked_at IS NULL) AND (warehouse_id IS NOT NULL));--> statement-breakpoint
CREATE INDEX "ura_user_active_idx" ON "wms"."user_role_assignment" USING btree ("user_id" int8_ops,"role" int8_ops,"role_domain" int8_ops,"warehouse_id" int8_ops,"importer_id" int8_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "ura_user_idx" ON "wms"."user_role_assignment" USING btree ("user_id" int8_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "ura_warehouse_idx" ON "wms"."user_role_assignment" USING btree ("warehouse_id" int8_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "user_role_assignment_uk" ON "wms"."user_role_assignment" USING btree ("user_id" enum_ops,"role" enum_ops,"warehouse_id" int8_ops,"importer_id" int8_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "perm_override_perm_idx" ON "wms"."permission_override" USING btree ("permission" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "permission_override_uk" ON "wms"."permission_override" USING btree ("user_id" int8_ops,"permission" int8_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "notification_actor_idx" ON "wms"."notification" USING btree ("actor_user_id" int8_ops) WHERE (actor_user_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "notification_correlation_idx" ON "wms"."notification" USING btree ("correlation_id" text_ops) WHERE (correlation_id IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedupe_uk" ON "wms"."notification" USING btree ("dedupe_key" text_ops);--> statement-breakpoint
CREATE INDEX "notification_entity_idx" ON "wms"."notification" USING btree ("entity_type" text_ops,"entity_id" text_ops);--> statement-breakpoint
CREATE INDEX "notification_event_fk_idx" ON "wms"."notification" USING btree ("event_key" text_ops);--> statement-breakpoint
CREATE INDEX "notification_feed_idx" ON "wms"."notification" USING btree ("recipient_user_id" int8_ops,"created_at" int8_ops);--> statement-breakpoint
CREATE INDEX "notification_imp_idx" ON "wms"."notification" USING btree ("importer_id" int8_ops) WHERE (importer_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "notification_rule_fk_idx" ON "wms"."notification" USING btree ("rule_id" int8_ops);--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "wms"."notification" USING btree ("recipient_user_id" int8_ops,"created_at" timestamptz_ops) WHERE (read_at IS NULL);--> statement-breakpoint
CREATE INDEX "notification_wh_idx" ON "wms"."notification" USING btree ("warehouse_id" int8_ops) WHERE (warehouse_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "notif_rule_role_idx" ON "wms"."notification_rule" USING btree ("role_filter" enum_ops) WHERE (role_filter IS NOT NULL);--> statement-breakpoint
CREATE INDEX "notification_rule_event_idx" ON "wms"."notification_rule" USING btree ("event_key" text_ops) WHERE is_active;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_rule_uk" ON "wms"."notification_rule" USING btree ("event_key" enum_ops,"audience" text_ops,"role_filter" text_ops);--> statement-breakpoint
CREATE INDEX "notif_delivery_due_idx" ON "wms"."notification_delivery" USING btree ("scheduled_for" timestamptz_ops) WHERE (status = ANY (ARRAY['PENDING'::wms.delivery_status, 'QUEUED'::wms.delivery_status]));--> statement-breakpoint
CREATE INDEX "notif_delivery_notification_idx" ON "wms"."notification_delivery" USING btree ("notification_id" int8_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "notif_delivery_provider_uk" ON "wms"."notification_delivery" USING btree ("provider" text_ops,"provider_message_id" text_ops) WHERE (provider_message_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "notif_delivery_retry_idx" ON "wms"."notification_delivery" USING btree ("next_retry_at" timestamptz_ops) WHERE (status = 'FAILED'::wms.delivery_status);--> statement-breakpoint
CREATE INDEX "notif_delivery_worker_idx" ON "wms"."notification_delivery" USING btree ("scheduled_for" enum_ops,"channel" enum_ops) WHERE (status = ANY (ARRAY['PENDING'::wms.delivery_status, 'QUEUED'::wms.delivery_status]));--> statement-breakpoint
CREATE UNIQUE INDEX "user_device_token_uk" ON "wms"."user_device" USING btree ("push_token" text_ops);--> statement-breakpoint
CREATE INDEX "user_device_user_idx" ON "wms"."user_device" USING btree ("user_id" int8_ops) WHERE is_active;--> statement-breakpoint
CREATE INDEX "role_permission_perm_idx" ON "wms"."role_permission" USING btree ("permission" text_ops);--> statement-breakpoint
CREATE INDEX "notif_pref_event_idx" ON "wms"."notification_preference" USING btree ("event_key" text_ops);--> statement-breakpoint
CREATE INDEX "wh_transporter_trp_idx" ON "wms"."warehouse_transporter" USING btree ("transporter_id" int8_ops);--> statement-breakpoint
CREATE VIEW "wms"."user_effective_permission" AS (SELECT ura.user_id, rp.permission, max(wms.access_rank(rp.scope)) AS scope_rank, (array_agg(rp.scope ORDER BY (wms.access_rank(rp.scope)) DESC))[1] AS scope, array_remove(array_agg(DISTINCT ura.warehouse_id), NULL::bigint) AS warehouse_ids, array_remove(array_agg(DISTINCT ura.importer_id), NULL::bigint) AS importer_ids, array_agg(DISTINCT ura.role) AS granted_by_roles FROM wms.user_role_assignment ura JOIN wms.role_permission rp ON rp.role = ura.role JOIN wms.users au ON au.id = ura.user_id WHERE ura.revoked_at IS NULL AND au.deleted_at IS NULL AND au.status = 'ACTIVE'::wms.record_status AND NOT (EXISTS ( SELECT 1 FROM wms.permission_override po WHERE po.user_id = ura.user_id AND po.permission = rp.permission AND po.revoked_at IS NULL AND (po.expires_at IS NULL OR po.expires_at > now()))) GROUP BY ura.user_id, rp.permission);--> statement-breakpoint
CREATE VIEW "wms"."v_last_change" AS (SELECT DISTINCT ON (entity_type, entity_id) entity_type, entity_id, entity_label, occurred_at, actor_user_id, actor_name, acting_role, operation, diff, reason FROM wms.audit_log WHERE result = 'SUCCESS'::wms.audit_result AND (operation = ANY (ARRAY['INSERT'::wms.audit_operation, 'UPDATE'::wms.audit_operation, 'DELETE'::wms.audit_operation, 'RESTORE'::wms.audit_operation])) ORDER BY entity_type, entity_id, occurred_at DESC);
*/