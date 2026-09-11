CREATE TYPE "public"."chat_message_kind" AS ENUM('user', 'request_created', 'request_confirmed', 'request_declined', 'request_cancelled', 'request_completed', 'request_no_show');--> statement-breakpoint
CREATE TYPE "public"."notification_side" AS ENUM('owner', 'customer');--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "sender_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "body" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "kind" "chat_message_kind" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "meta_json" jsonb;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "side" "notification_side";--> statement-breakpoint
--
-- Бэкфил дописан руками: drizzle отдаёт только ADD COLUMN, и у всех прежних
-- строк side остался бы NULL. А счётчик и гашение переезжают со списков видов
-- на эту колонку — непрочитанное, заведённое до миграции, перестало бы
-- считаться или не погасло бы никогда.
--
-- Правило повторяет прежнее sideForKind: request_created и request_cancelled
-- адресованы владельцу, остальные виды заявок — арендатору. У chat_message
-- стороны нет, поэтому он остаётся NULL. Прецедент правки сгенерированного
-- файла — 0010_bouncy_bucky.sql.
UPDATE "notifications" SET "side" = CASE
  WHEN "kind" IN ('request_created', 'request_cancelled') THEN 'owner'::"notification_side"
  WHEN "kind" <> 'chat_message' THEN 'customer'::"notification_side"
END
WHERE "side" IS NULL;