ALTER TABLE "booking_requests" ADD COLUMN "confirmed_at" timestamp;--> statement-breakpoint
--
-- Бэкфил дописан руками: без него у всех уже подтверждённых броней колонка
-- осталась бы пустой, и арендатор потерял бы телефон владельца в момент
-- выкладки — правило раскрытия переезжает с текущего статуса на эту отметку.
--
-- Время берём из журнала событий: transitionRequest пишет туда
-- request_confirmed. Ветка с EXISTS обязательна — она поднимает брони,
-- отменённые ПОСЛЕ подтверждения: у них статус 'cancelled', и по одному
-- статусу их не отличить от заявки, отозванной до всякого согласия.
UPDATE "booking_requests" br SET "confirmed_at" = COALESCE(
  (SELECT min(e.created_at) FROM "events" e
    WHERE e.entity_type = 'booking_request'
      AND e.entity_id = br.id AND e.event = 'request_confirmed'),
  br.responded_at)
WHERE br.status IN ('confirmed', 'completed', 'no_show')
   OR EXISTS (SELECT 1 FROM "events" e
              WHERE e.entity_type = 'booking_request'
                AND e.entity_id = br.id AND e.event = 'request_confirmed');
