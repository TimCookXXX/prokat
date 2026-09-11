-- Заявка начинает помнить условия, на которых её подали, — см. ADR 0019.
--
-- Файл дописан руками против сгенерированного. Drizzle предлагает
-- `ADD COLUMN price_day integer NOT NULL` одним шагом, а это падает на любой
-- непустой таблице: значения для существующих строк взять неоткуда. Поэтому
-- колонка заводится пустой, заполняется из объявления и только потом
-- закрывается NOT NULL.
--
-- Бэкфил берёт ТЕКУЩИЕ условия вещи — ровно то, из чего стоимость считалась до
-- сих пор. Настоящих условий на момент старых заявок не знает никто, и
-- подставить их неоткуда; значит регресса нет: что показывалось вчера, то
-- покажется и завтра. Начиная с этой миграции цифра перестаёт плыть.
ALTER TABLE "booking_requests" ADD COLUMN "price_day" integer;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "deposit_type" "deposit_type" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "deposit_amount" integer;--> statement-breakpoint

UPDATE "booking_requests" br SET
    "price_day"      = l."price_day",
    "deposit_type"   = l."deposit_type",
    "deposit_amount" = l."deposit_amount"
  FROM "listings" l WHERE l."id" = br."listing_id";--> statement-breakpoint

ALTER TABLE "booking_requests" ALTER COLUMN "price_day" SET NOT NULL;
