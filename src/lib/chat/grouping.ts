// Сборка ленты переписки и фильтрация списка. Чистая логика без React и без БД:
// то же основание, что у rules.ts — тесты проекта живого Postgres не требуют.
//
// Тип сообщения здесь свой, а не импортированный из server/chat: зависимости
// идут app → server → lib, обратная ссылка ломала бы направление. Он
// структурно совместим с ThreadMessage.
//
// Отклонение от плана, названное вслух: вместо отдельной groupMessages сделана
// buildFeed, которая за один проход расставляет и группы, и разделители. Считать
// их порознь нельзя — разделитель дня рвёт группу, а разделитель непрочитанного
// рвёт её в другом месте, и компоненту пришлось бы заново выводить границы дней.

import { content } from "@theme/content";
import { isUnreadFor } from "@/lib/chat/unread";
import { isSystemKind, type ChatMessageKind, type ChatSystemMeta } from "@/lib/chat/system-message";

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export type FeedMessage = {
  id: string;
  /** Пусто у записи о сделке. */
  senderUserId: string | null;
  kind: ChatMessageKind;
  body: string | null;
  meta: ChatSystemMeta | null;
  createdAt: Date;
};

/* Запись о сделке — свой вид элемента, а не пузырь: она ничья, и уложить её в
 * группу «моё/чужое» нельзя. Пока сторону выводили сравнением с отправителем,
 * пустой отправитель делал её чужой, и она вставала серым пузырём слева. */
export type FeedItem =
  | { kind: "date"; key: string; label: string }
  | { kind: "unread"; key: string; count: number }
  | { kind: "system"; key: string; message: FeedMessage }
  | { kind: "group"; key: string; mine: boolean; messages: FeedMessage[] };

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

// Календарный день по локальному времени: разница в часах тут не годится,
// вчерашние 23:30 и сегодняшние 00:30 — разные дни при разнице в час.
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function dayLabel(date: Date, now: Date = new Date()): string {
  const today = dayKey(now);
  if (dayKey(date) === today) return content.chat.today;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return content.chat.yesterday;

  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  // Год у прошлогодней переписки обязателен: «28 августа» без него — враньё.
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

// Первое непрочитанное чужое сообщение. Считается ДО markThreadRead и дальше
// держится в состоянии компонента, иначе разделитель исчезнет сразу после
// открытия переписки.
export function unreadAnchor(
  messages: FeedMessage[],
  viewerCursor: string | null,
  viewerId: string,
): string | null {
  const first = messages
    .filter((m) => isUnreadFor(m, viewerId, viewerCursor))
    .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  return first?.id ?? null;
}

export function buildFeed(
  messages: FeedMessage[],
  { viewerId, unreadAnchorId, now }: {
    viewerId: string;
    unreadAnchorId?: string | null;
    now?: Date;
  },
): FeedItem[] {
  if (messages.length === 0) return [];

  // Сортировка своя: в задаче 2 массив начнёт доливать сокет, и порядок прихода
  // не гарантирован. id — монотонный ULID, поэтому годится ключом.
  const ordered = [...messages].sort((a, b) => (a.id < b.id ? -1 : 1));
  const at = now ?? new Date();

  // Курсором служит сам якорь: всё от него и ниже — непрочитанное. Записи о
  // сделке в счёт не идут, за это отвечает то же правило, что и в SQL.
  const unreadCount = unreadAnchorId
    ? ordered.filter((m) => m.id >= unreadAnchorId && isUnreadFor(m, viewerId, null)).length
    : 0;

  const feed: FeedItem[] = [];
  let currentDay: string | null = null;
  let group: { mine: boolean; messages: FeedMessage[] } | null = null;

  const flush = () => {
    if (!group) return;
    feed.push({
      kind: "group",
      key: `g-${group.messages[0].id}`,
      mine: group.mine,
      messages: group.messages,
    });
    group = null;
  };

  for (const message of ordered) {
    const day = dayKey(message.createdAt);
    const mine = message.senderUserId === viewerId;

    if (day !== currentDay) {
      flush();
      feed.push({ kind: "date", key: `d-${day}`, label: dayLabel(message.createdAt, at) });
      currentDay = day;
    }

    if (unreadAnchorId && message.id === unreadAnchorId) {
      flush();
      feed.push({ kind: "unread", key: `u-${message.id}`, count: unreadCount });
    }

    if (isSystemKind(message.kind)) {
      flush();
      feed.push({ kind: "system", key: `s-${message.id}`, message });
      continue;
    }

    const previous = group?.messages[group.messages.length - 1];
    const continues = group
      && group.mine === mine
      && previous
      && message.createdAt.getTime() - previous.createdAt.getTime() <= GROUP_WINDOW_MS;

    if (continues && group) group.messages.push(message);
    else {
      flush();
      group = { mine, messages: [message] };
    }
  }
  flush();

  return feed;
}

export type ThreadFilter = "all" | "unread" | "mine";

// Ровно те поля, по которым идёт отбор: модуль не должен зависеть от остальной
// формы ThreadListItem.
export type ThreadSummary = {
  counterpartName: string | null;
  listingTitle: string;
  preview: string;
  unread: number;
  iAmOwner: boolean;
};

export function filterThreads<T extends ThreadSummary>(
  threads: T[],
  query: string,
  filter: ThreadFilter,
): T[] {
  const needle = query.trim().toLowerCase();

  return threads.filter((t) => {
    if (filter === "unread" && t.unread === 0) return false;
    if (filter === "mine" && !t.iAmOwner) return false;
    if (!needle) return true;

    return [t.counterpartName, t.listingTitle, t.preview]
      .some((field) => field?.toLowerCase().includes(needle));
  });
}
