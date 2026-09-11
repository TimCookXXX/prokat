-- Значение no_show снято из трёх перечислений — см. ADR 0018.
--
-- Файл дописан руками против сгенерированного. Drizzle предлагает подменить
-- тип через text, но не видит трёх вещей, и на живой базе его вариант падает —
-- проверено, каждый пункт получен падением, а не додуман:
--
--  1. Уцелевшие значения. Приведение `USING kind::новый_тип` спотыкается о
--     первую же строку со снятым значением. Переписываем их заранее — здесь
--     это no-op, но код миграции переживает свою базу.
--  2. DEFAULT колонки. Он хранится приведённым к КОНКРЕТНОМУ типу, и DROP TYPE
--     упирается в него, даже когда сама колонка уже текстовая.
--  3. Частичный уникальный индекс и CHECK. Их предикаты хранятся в разобранном
--     виде, тоже со ссылкой на тип: пока колонка стоит текстом, предикат
--     читается как `text = booking_status` и ломает ALTER.
--
-- Снятое возвращается дословно: определения обязаны совпасть с
-- drizzle/schema.ts, иначе следующий db:generate предложит их переделать.
--
-- Неявка значит, что аренды НЕ БЫЛО, поэтому её место среди расторгнутых, а не
-- среди доведённых до конца: счётчики сделок в кабинете и на витрине считают
-- completed, и оставлять там «не пришёл» было неверно с самого начала.
UPDATE "booking_requests" SET "status" = 'cancelled' WHERE "status" = 'no_show';--> statement-breakpoint
-- Запись в переписке остаётся: тред — журнал сделки, и вырезать из него
-- событие хуже, чем назвать его точнее.
UPDATE "chat_messages" SET "kind" = 'request_cancelled' WHERE "kind" = 'request_no_show';--> statement-breakpoint
-- Уведомления живут до прочтения и чистятся лениво — непрочитанное о снятом
-- виде события просто удаляем.
DELETE FROM "notifications" WHERE "kind" = 'request_no_show';--> statement-breakpoint

DROP INDEX "booking_requests_live_dup_uq";--> statement-breakpoint
ALTER TABLE "booking_requests" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."booking_requests" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."booking_status";--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('new', 'confirmed', 'declined', 'expired', 'completed', 'cancelled');--> statement-breakpoint
ALTER TABLE "public"."booking_requests" ALTER COLUMN "status" SET DATA TYPE "public"."booking_status" USING "status"::"public"."booking_status";--> statement-breakpoint
ALTER TABLE "booking_requests" ALTER COLUMN "status" SET DEFAULT 'new';--> statement-breakpoint
CREATE UNIQUE INDEX "booking_requests_live_dup_uq" ON "booking_requests" USING btree ("listing_id","customer_user_id","date_from","date_to") WHERE "booking_requests"."status" = 'new';--> statement-breakpoint

ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_kind_shape";--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."chat_messages" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."chat_message_kind";--> statement-breakpoint
CREATE TYPE "public"."chat_message_kind" AS ENUM('user', 'request_created', 'request_confirmed', 'request_declined', 'request_cancelled', 'request_completed');--> statement-breakpoint
ALTER TABLE "public"."chat_messages" ALTER COLUMN "kind" SET DATA TYPE "public"."chat_message_kind" USING "kind"::"public"."chat_message_kind";--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "kind" SET DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_kind_shape" CHECK (
    ("chat_messages"."kind" = 'user' and "chat_messages"."sender_user_id" is not null and "chat_messages"."body" is not null)
    or ("chat_messages"."kind" <> 'user' and "chat_messages"."sender_user_id" is null and "chat_messages"."body" is null));--> statement-breakpoint

ALTER TABLE "public"."notifications" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."notification_kind";--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('chat_message', 'request_created', 'request_cancelled', 'request_confirmed', 'request_declined', 'request_completed');--> statement-breakpoint
ALTER TABLE "public"."notifications" ALTER COLUMN "kind" SET DATA TYPE "public"."notification_kind" USING "kind"::"public"."notification_kind";
