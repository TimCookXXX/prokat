CREATE TYPE "public"."claim_status" AS ENUM('new', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."lead_type" AS ENUM('show_phone', 'call', 'request', 'regular_request', 'price_outdated', 'claim_click');--> statement-breakpoint
CREATE TYPE "public"."regular_request_status" AS ENUM('new', 'sent', 'closed');--> statement-breakpoint
CREATE TYPE "public"."seo_word" AS ENUM('prokat', 'arenda');--> statement-breakpoint
CREATE TYPE "public"."shop_status" AS ENUM('unclaimed', 'claimed', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."verified_by" AS ENUM('call', 'site', 'listing', 'shop');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "item_classes" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"short_hint" varchar(160),
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "item_classes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "item_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(100) NOT NULL,
	"name_genitive" varchar(120) NOT NULL,
	"seo_word" "seo_word" DEFAULT 'prokat' NOT NULL,
	"guide" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "item_groups_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_events" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"type" "lead_type" NOT NULL,
	"offer_id" text,
	"shop_id" text,
	"item_class_id" text,
	"session_id" varchar(64),
	"tab" varchar(20),
	"rank_position" integer,
	"scenario" jsonb,
	"utm" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"item_class_id" text NOT NULL,
	"model" varchar(120),
	"price_day" integer,
	"price_week" integer,
	"min_days" integer DEFAULT 1 NOT NULL,
	"deposit_rub" integer,
	"deposit_document" boolean DEFAULT false NOT NULL,
	"delivery_available" boolean DEFAULT false NOT NULL,
	"delivery_price" integer DEFAULT 0 NOT NULL,
	"delivery_free_from" integer,
	"delivery_same_day" boolean DEFAULT false NOT NULL,
	"verified_at" date NOT NULL,
	"verified_by" "verified_by" DEFAULT 'call' NOT NULL,
	"source_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "offers_shop_class_model_uq" UNIQUE NULLS NOT DISTINCT("shop_id","item_class_id","model"),
	CONSTRAINT "offers_has_price" CHECK ("offers"."price_day" IS NOT NULL OR "offers"."price_week" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regular_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"city_id" text NOT NULL,
	"what" text NOT NULL,
	"frequency" varchar(60),
	"contact" varchar(120) NOT NULL,
	"status" "regular_request_status" DEFAULT 'new' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rental_shops" (
	"id" text PRIMARY KEY NOT NULL,
	"city_id" text NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(200) NOT NULL,
	"district" varchar(80),
	"address" text,
	"phone" varchar(20),
	"telegram" varchar(100),
	"website" text,
	"source_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "shop_status" DEFAULT 'unclaimed' NOT NULL,
	"owner_user_id" text,
	"claimed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rental_shops_city_slug_uq" UNIQUE("city_id","slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shop_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text,
	"shop_name" varchar(200),
	"city_id" text NOT NULL,
	"user_id" text NOT NULL,
	"contact_name" varchar(100) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"comment" text,
	"status" "claim_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp,
	"decided_by" text
);
--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "name_prepositional" varchar(100);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "item_classes" ADD CONSTRAINT "item_classes_group_id_item_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."item_groups"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "item_groups" ADD CONSTRAINT "item_groups_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_shop_id_rental_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."rental_shops"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_item_class_id_item_classes_id_fk" FOREIGN KEY ("item_class_id") REFERENCES "public"."item_classes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_shop_id_rental_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."rental_shops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_item_class_id_item_classes_id_fk" FOREIGN KEY ("item_class_id") REFERENCES "public"."item_classes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "regular_requests" ADD CONSTRAINT "regular_requests_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_shops" ADD CONSTRAINT "rental_shops_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_shops" ADD CONSTRAINT "rental_shops_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shop_claims" ADD CONSTRAINT "shop_claims_shop_id_rental_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."rental_shops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shop_claims" ADD CONSTRAINT "shop_claims_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shop_claims" ADD CONSTRAINT "shop_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shop_claims" ADD CONSTRAINT "shop_claims_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_classes_group_idx" ON "item_classes" USING btree ("group_id","sort");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_groups_category_idx" ON "item_groups" USING btree ("category_id","sort");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_events_shop_idx" ON "lead_events" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_events_class_idx" ON "lead_events" USING btree ("item_class_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_events_type_idx" ON "lead_events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_class_idx" ON "offers" USING btree ("item_class_id","is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_shop_idx" ON "offers" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_shops_city_status_idx" ON "rental_shops" USING btree ("city_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_shops_owner_idx" ON "rental_shops" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_claims_status_idx" ON "shop_claims" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_claims_user_idx" ON "shop_claims" USING btree ("user_id");