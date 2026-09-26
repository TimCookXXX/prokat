CREATE TYPE "public"."district_kind" AS ENUM('okrug', 'microdistrict');--> statement-breakpoint
ALTER TYPE "public"."lead_type" ADD VALUE 'map_open';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(80) NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "brands_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "districts" (
	"id" text PRIMARY KEY NOT NULL,
	"city_id" text NOT NULL,
	"kind" "district_kind" NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(100) NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"parent_id" text,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "districts_city_slug_uq" UNIQUE("city_id","slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_aliases" (
	"alias" varchar(160) PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_models" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"item_class_id" text NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"family" varchar(120),
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"specs_source_url" text,
	"photo_url" text,
	"photo_license" varchar(200),
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "product_models_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "offers" DROP CONSTRAINT "offers_shop_class_model_uq";--> statement-breakpoint
ALTER TABLE "item_classes" ADD COLUMN "search_keywords" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_events" ADD COLUMN "model_id" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "model_id" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "model_key" varchar(200) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "includes" text;--> statement-breakpoint
ALTER TABLE "rental_shops" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "rental_shops" ADD COLUMN "lon" double precision;--> statement-breakpoint
ALTER TABLE "rental_shops" ADD COLUMN "microdistrict_id" text;--> statement-breakpoint
ALTER TABLE "rental_shops" ADD COLUMN "okrug_id" text;--> statement-breakpoint
ALTER TABLE "rental_shops" ADD COLUMN "hours" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "districts" ADD CONSTRAINT "districts_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "districts" ADD CONSTRAINT "districts_parent_id_districts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_aliases" ADD CONSTRAINT "model_aliases_model_id_product_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."product_models"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_models" ADD CONSTRAINT "product_models_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_models" ADD CONSTRAINT "product_models_item_class_id_item_classes_id_fk" FOREIGN KEY ("item_class_id") REFERENCES "public"."item_classes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "districts_city_kind_idx" ON "districts" USING btree ("city_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_aliases_model_idx" ON "model_aliases" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_models_class_idx" ON "product_models" USING btree ("item_class_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_model_id_product_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."product_models"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_model_id_product_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."product_models"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_shops" ADD CONSTRAINT "rental_shops_microdistrict_id_districts_id_fk" FOREIGN KEY ("microdistrict_id") REFERENCES "public"."districts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_shops" ADD CONSTRAINT "rental_shops_okrug_id_districts_id_fk" FOREIGN KEY ("okrug_id") REFERENCES "public"."districts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_model_idx" ON "offers" USING btree ("model_id");--> statement-breakpoint
-- Ключ модели для уже записанных предложений — временный и заведомо уникальный
-- (по id строки): разные написания одной модели у проката («HR2470», «HR-2470»)
-- не должны уронить уникальный индекс. db:sync-catalog (при старте контейнера)
-- привяжет их к моделям справочника и пересчитает ключ по modelKey().
UPDATE "offers" SET "model_key" = 'r:tmp:' || "id" WHERE "model" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_shop_class_model_key_uq" UNIQUE("shop_id","item_class_id","model_key");