DROP INDEX "wms"."users_name_trgm";--> statement-breakpoint
CREATE INDEX "users_name_trgm" ON "wms"."users" USING gin ((((first_name || ' '::text) || last_name)) gin_trgm_ops);