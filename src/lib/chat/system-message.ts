// Запись о сделке в переписке по вещи: текст собирается из вида и meta.
//
// Почему текст не хранится: тред служит журналом сделки и живёт годами, а
// формулировку захочется править. Если бы строка лежала в базе, правка означала
// бы переписывание истории — и старые треды остались бы со старым текстом
// навсегда.
//
// Модуль чистый: тесты проекта живого Postgres не требуют, а это единственное
// место, где вид записи превращается в то, что человек прочитает.

import { content } from "@theme/content";
import { formatDayMonth } from "@/lib/catalog/dates";

export const CHAT_SYSTEM_KINDS = [
  "request_created",
  "request_confirmed",
  "request_declined",
  "request_cancelled",
  "request_completed",
  "request_no_show",
] as const;

export type ChatSystemKind = (typeof CHAT_SYSTEM_KINDS)[number];
/** `user` — реплика человека; всё остальное пишет сама сделка. */
export type ChatMessageKind = "user" | ChatSystemKind;

export function isSystemKind(kind: string): kind is ChatSystemKind {
  return (CHAT_SYSTEM_KINDS as readonly string[]).includes(kind);
}

/* Данные записи. Заявка может исчезнуть из виду (её страница, права, статус),
 * поэтому всё, что нужно прочитать запись, лежит рядом с ней. Поля
 * необязательны: старые записи и записи, у которых чего-то нет, обязаны
 * дочитываться, а не ронять ленту. */
export type ChatSystemMeta = {
  requestId?: string;
  from?: string;
  to?: string;
  qty?: number;
};

function period(meta: ChatSystemMeta): string | null {
  if (!meta.from || !meta.to) return null;
  return meta.from === meta.to
    ? formatDayMonth(meta.from)
    : `${formatDayMonth(meta.from)} — ${formatDayMonth(meta.to)}`;
}

/* Строка записи: что произошло, а под ним — с какими датами. Обе части
 * возвращаются отдельно, потому что лента набирает их разным кеглем, а превью
 * в списке переписок берёт только первую. */
export function systemMessageText(
  kind: ChatSystemKind,
  meta: ChatSystemMeta | null,
): { title: string; detail: string | null } {
  const title = content.chatSystem[kind];
  const m = meta ?? {};
  const p = period(m);
  if (!p) return { title, detail: null };
  return { title, detail: m.qty && m.qty > 1 ? `${p} · ${m.qty} шт.` : p };
}

/** Одной строкой — для превью в списке переписок и для скринридера. */
export function systemMessageLine(
  kind: ChatSystemKind,
  meta: ChatSystemMeta | null,
): string {
  const { title, detail } = systemMessageText(kind, meta);
  return detail ? `${title}: ${detail}` : title;
}
