// Виды уведомлений и правила их выбора. Модуль чистый — базы не знает, поэтому
// покрыт тестами без живого Postgres. Это единственное место, где точка записи
// связывается с видом.
//
// Список продублирован в drizzle/schema.ts: слой db не имеет права импортировать
// из lib (направление зависимостей app → server → lib → db). От расхождения
// страхует тест, сверяющий enumValues с этим списком.

import type { BookingStatus } from "@/lib/catalog/booking-status";

export const NOTIFICATION_KINDS = [
  "chat_message",
  "request_created",
  "request_cancelled",
  "request_confirmed",
  "request_declined",
  "request_completed",
  "request_no_show",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// Виды, относящиеся к заявке. Отдельный тип, потому что у события доставки
// разные формы: у заявки нет ни threadId, ни messageId.
export type RequestNotificationKind = Exclude<NotificationKind, "chat_message">;

/* Какой стороной человек оказывается в событии. Лента показывает обе роли и
 * умеет фильтроваться по одной, поэтому всплывашку надо гасить не «на ленте
 * вообще», а только когда показанная сторона совпадает: иначе событие по своей
 * заявке, пришедшее при фильтре «я сдаю», не покажется нигде.
 *
 * Сторону называет точка записи и хранит колонка `notifications.side` —
 * вывести её из вида нельзя, почему именно см. в drizzle/schema.ts рядом с
 * колонкой. */
export type NotificationSide = "owner" | "customer";

// Решения владельца по заявке — подмножество BookingStatus. Сужение не
// косметика: transitionRequest принимает все семь статусов, а вид уведомления
// есть только у четырёх, и `request_${to}` на полном union не типизируется.
export type OwnerDecision = Extract<
  BookingStatus,
  "confirmed" | "declined" | "completed" | "no_show"
>;

// Возвращаемый тип сужен до request_*: решение владельца не может дать
// chat_message, и widening до NotificationKind ломал бы вызывающих, которым
// нужна именно заявка.
export function kindForDecision(to: OwnerDecision): RequestNotificationKind {
  return `request_${to}`;
}

// Получателя задаёт точка записи, а не вид: request_cancelled рождается и у
// владельца (отменил арендатор), и у арендатора (владелец отменил
// подтверждённую). Здесь только охранник «не уведомляй самого себя»; почему
// стороны всё ещё могут совпасть — в server/notifications.ts.
export function notificationRecipient(
  recipientId: string | null,
  actorId: string,
): string | null {
  if (!recipientId || recipientId === actorId) return null;
  return recipientId;
}
