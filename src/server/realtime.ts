// Публикация события доставки. Мост между транзакцией в app и процессом
// realtime: pg_notify доставляет payload только после коммита, поэтому событие
// не может обогнать данные, о которых рассказывает.
//
// Вызывается ПОСЛЕДНИМ оператором транзакции. Причина не в стиле: ошибка внутри
// транзакции откатывает её целиком — то есть сообщение пользователя не
// сохранилось бы из-за неудачного уведомления. Savepoint для этого не нужен:
// длина payload гарантируется построением (ULID фиксированной длины, тела
// сообщения в событии нет), а лимит pg_notify — почти 8 КБ.

import { and, eq, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/lib/db";
import { bookingRequests, chatMessages, chatThreads, listings, users } from "@db/schema";
import { canReadThread } from "@/lib/chat/rules";
import { toPreview } from "@/server/chat";
import { notificationTarget } from "@/lib/notifications/target";
import type { RequestNotificationKind } from "@/lib/notifications/kinds";
import { content } from "@theme/content";
import {
  REALTIME_CHANNEL, serializeNotify, type NotifyPayload,
} from "@/lib/realtime/events";

export async function publish(tx: Tx, payload: NotifyPayload): Promise<void> {
  await tx.execute(sql`select pg_notify(${REALTIME_CHANNEL}, ${serializeNotify(payload)})`);
}

// ============================== Содержимое тоста ==============================
// Тело сообщения через сокет не возим — событие несёт только идентификаторы.
// Значит текст всплывашки дочитывается здесь, и здесь же ещё раз проверяется
// участие: даже неверный список получателей содержимого не раскроет.

export type ToastContent = {
  title: string;
  text: string;
  href: string;
  /** Для заявок — чьей стороны событие. Лента фильтруется по роли, и без этого
   *  всплывашку пришлось бы гасить на всей ленте разом. */
  side?: "owner" | "customer";
};

export async function readMessageToast(
  viewerId: string,
  threadId: string,
  messageId: string,
): Promise<ToastContent | null> {
  const rows = await getDb().select({
    body: chatMessages.body,
    kind: chatMessages.kind,
    senderUserId: chatMessages.senderUserId,
    ownerUserId: chatThreads.ownerUserId,
    customerUserId: chatThreads.customerUserId,
    senderName: users.name,
  })
    .from(chatMessages)
    .innerJoin(chatThreads, eq(chatThreads.id, chatMessages.threadId))
    .innerJoin(users, eq(users.id, chatMessages.senderUserId))
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.threadId, threadId)))
    .limit(1);
  const row = rows[0];
  if (!row || !canReadThread(viewerId, row)) return null;
  // Своё же сообщение всплывать не должно: эхо приходит и отправителю.
  if (row.senderUserId === viewerId) return null;
  // Запись о сделке всплывашки не даёт: о ней уже сказало событие по заявке, и
  // второй раз одно и то же выскакивать не должно. Отправителя у неё нет,
  // поэтому innerJoin выше её и так не вернёт — но полагаться на это нельзя,
  // условие должно быть названо.
  if (row.kind !== "user" || row.body === null) return null;

  return {
    title: row.senderName ?? "Новое сообщение",
    text: toPreview(row.body),
    href: `/chat/${threadId}`,
  };
}

export async function readRequestToast(
  viewerId: string,
  requestId: string,
  kind: RequestNotificationKind,
): Promise<ToastContent | null> {
  const rows = await getDb().select({
    ownerUserId: bookingRequests.ownerUserId,
    customerUserId: bookingRequests.customerUserId,
    listingTitle: listings.title,
  })
    .from(bookingRequests)
    .innerJoin(listings, eq(listings.id, bookingRequests.listingId))
    .where(eq(bookingRequests.id, requestId))
    .limit(1);
  const row = rows[0];
  // Чужая заявка не показывается даже при неверном списке получателей.
  if (!row || (row.ownerUserId !== viewerId && row.customerUserId !== viewerId)) return null;

  return {
    title: content.notifications.kinds[kind],
    text: row.listingTitle,
    href: notificationTarget(kind, requestId).href,
    // Сторона — из самой заявки, а не из вида события: вид её не задаёт.
    // Смотрящий обязан быть одной из сторон, это проверено выше.
    side: row.ownerUserId === viewerId ? "owner" : "customer",
  };
}
