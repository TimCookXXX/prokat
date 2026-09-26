CREATE TYPE "public"."request_kind" AS ENUM('regular', 'not_found');--> statement-breakpoint
ALTER TABLE "regular_requests" ADD COLUMN "kind" "request_kind" DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "regular_requests" ADD COLUMN "period" varchar(60);