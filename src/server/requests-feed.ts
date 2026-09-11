// Сборка строк ленты заявок из строк выборки. Отдельным серверным модулем,
// потому что вызывающих два — лента и страница вещи в кабинете, — а положить
// функции рядом с компонентом нельзя: у модуля с "use client" все экспорты
// становятся клиентскими ссылками, и серверный вызов падает в рантайме.
// Тип FeedRow импортируется только как тип — типы границу не пересекают.

import { rentalDaysCount } from "@/lib/booking/params";
import type { CabinetRequestRow } from "@/server/cabinet";
import type { FeedRow } from "@/components/cabinet/RequestsFeed";

export function toFeedRow(r: CabinetRequestRow): FeedRow {
  // Горит только новая заявка владельцу: ответить на неё может он один, и
  // охряный призыв к действию у арендатора звал бы туда, где кнопок нет.
  const hot = r.side === "owner" && r.status === "new";
  const days = rentalDaysCount({ from: r.dateFrom, to: r.dateTo, qty: r.qty });

  return {
    ...r,
    // Date через границу RSC проходит, но строка честнее: клиенту нужны только
    // вывод и сравнение, а несериализуемого в пропсах лучше не держать.
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    hot,
    // По цене из самой заявки, а не по сегодняшней цене вещи: иначе сумма
    // старой заявки ползла бы вслед за прайсом владельца, и человек видел бы
    // не то, на что соглашался. Снимок — в drizzle/schema.ts.
    estimate: days > 0 ? r.priceDay * days * r.qty : null,
  };
}

/* Вес строки: сперва то, что требует действия, затем идущее, закрытые позади.
 * Внутри веса — свежие выше. Сортировка в JS, а не в SQL: правило читается
 * рядом с лентой, а строк у человека десятки, не тысячи. */
export function sortFeedRows(rows: FeedRow[]): FeedRow[] {
  const weight = (r: FeedRow) =>
    r.hot ? 0 : r.status === "new" || r.status === "confirmed" ? 1 : 2;
  return [...rows].sort(
    (a, b) => weight(a) - weight(b) || (a.createdAt < b.createdAt ? 1 : -1),
  );
}

/* Порядок строк СВОДКИ — другое правило, чем у ленты, и подменять им
 * sortFeedRows нельзя: лента сортирует по свежести намеренно.
 *
 * Здесь наверху то, что сгорит раньше всех, потом идущее по дате начала.
 * Сортировка по сроку, а не по свежести, — не вкусовщина: expiresAt ставится
 * как «создано + 24 часа» одной константой, поэтому «свежие сверху» — это
 * ровно ОБРАТНЫЙ порядок к «горит раньше». Со срезом до N это означало бы, что
 * из панели вылетают именно те заявки, ради которых она и сделана.
 *
 * По той же причине резать полагается здесь, а не лимитом в SQL: тот
 * применяется до сортировки. Заодно остаток считается бесплатно и честно. */
export function summaryRows(rows: FeedRow[], limit: number): {
  shown: FeedRow[];
  rest: number;
} {
  const weight = (r: FeedRow) => (r.status === "new" ? 0 : 1);
  const sorted = [...rows].sort((a, b) => {
    const w = weight(a) - weight(b);
    if (w !== 0) return w;
    // Ждущие ответа — по сроку: первым то, что закроется само раньше всех.
    if (a.status === "new") return a.expiresAt < b.expiresAt ? -1 : 1;
    // Идущие — по дате начала: ближайшая передача или возврат впереди.
    return a.dateFrom < b.dateFrom ? -1 : a.dateFrom > b.dateFrom ? 1 : 0;
  });
  return { shown: sorted.slice(0, limit), rest: Math.max(0, sorted.length - limit) };
}
