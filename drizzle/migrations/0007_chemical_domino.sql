CREATE TYPE "public"."geo_precision" AS ENUM('house', 'interpolated', 'street', 'place');--> statement-breakpoint
CREATE TYPE "public"."geo_source" AS ENUM('osm', 'gar', 'osm+gar', 'manual');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_houses" (
	"id" text PRIMARY KEY NOT NULL,
	"city_id" text NOT NULL,
	"street_id" text,
	"place_id" text,
	"number" varchar(40) NOT NULL,
	"number_norm" varchar(40) NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"precision" "geo_precision" NOT NULL,
	"source" "geo_source" NOT NULL,
	"postcode" varchar(6),
	"osm_ref" varchar(24),
	"gar_guid" varchar(36),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"city_id" text NOT NULL,
	"version" varchar(64) NOT NULL,
	"built_at" timestamp DEFAULT now() NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_places" (
	"id" text PRIMARY KEY NOT NULL,
	"city_id" text NOT NULL,
	"kind" varchar(20) NOT NULL,
	"name" varchar(160) NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"parent_id" text,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"bounds" jsonb,
	"source" "geo_source" NOT NULL,
	"osm_ref" varchar(24),
	"gar_guid" varchar(36),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_pois" (
	"id" text PRIMARY KEY NOT NULL,
	"city_id" text NOT NULL,
	"place_id" text,
	"name" varchar(200) NOT NULL,
	"kind" varchar(30) NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"address" varchar(200),
	"source" "geo_source" NOT NULL,
	"osm_ref" varchar(24),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_streets" (
	"id" text PRIMARY KEY NOT NULL,
	"city_id" text NOT NULL,
	"place_id" text,
	"name" varchar(200) NOT NULL,
	"type" varchar(30) DEFAULT '' NOT NULL,
	"name_key" varchar(200) NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"houses" integer DEFAULT 0 NOT NULL,
	"source" "geo_source" NOT NULL,
	"gar_guid" varchar(36),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_houses" ADD CONSTRAINT "geo_houses_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_houses" ADD CONSTRAINT "geo_houses_street_id_geo_streets_id_fk" FOREIGN KEY ("street_id") REFERENCES "public"."geo_streets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_houses" ADD CONSTRAINT "geo_houses_place_id_geo_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."geo_places"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_imports" ADD CONSTRAINT "geo_imports_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_places" ADD CONSTRAINT "geo_places_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_places" ADD CONSTRAINT "geo_places_parent_id_geo_places_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."geo_places"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_pois" ADD CONSTRAINT "geo_pois_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_pois" ADD CONSTRAINT "geo_pois_place_id_geo_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."geo_places"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_streets" ADD CONSTRAINT "geo_streets_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_streets" ADD CONSTRAINT "geo_streets_place_id_geo_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."geo_places"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_houses_city_idx" ON "geo_houses" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_houses_street_number_idx" ON "geo_houses" USING btree ("street_id","number_norm");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_houses_place_idx" ON "geo_houses" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_houses_lat_lon_idx" ON "geo_houses" USING btree ("lat","lon");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_imports_city_built_idx" ON "geo_imports" USING btree ("city_id","built_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_places_city_kind_idx" ON "geo_places" USING btree ("city_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_places_parent_idx" ON "geo_places" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_pois_city_idx" ON "geo_pois" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_streets_city_idx" ON "geo_streets" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_streets_place_key_idx" ON "geo_streets" USING btree ("place_id","name_key");