// Сборка строк ленты заявок из строк выборки. Отдельным серверным модулем,
// потому что вызывающих два — лента и страница вещи в кабинете, — а положить
// функции рядом с компонентом нельзя: у модуля с "use client" все экспорты
// становятся клиентскими ссылками, и серверный вызов падает в рантайме.
// Тип FeedRow импортируется только как тип — типы границу не пересекают.

import { rentalDaysCount } from "@/lib/booking/params";
import { daysBetween } from "@/lib/catalog/dates";
import type { CabinetRequestRow } from "@/server/cabinet";
import type { FeedRow } from "@/components/cabinet/RequestsFeed";

export function toFeedRow(r: CabinetRequestRow, today: string): FeedRow {
  const hot = r.side === "owner" && r.status === "new";
  // Только владельцу: отметить итог может он один, и охряный призыв к
  // действию у арендатора звал бы туда, где кнопок нет.
  const overdue = r.side === "owner" && r.status === "confirmed" && r.dateTo < today;
  const days = rentalDaysCount({ from: r.dateFrom, to: r.dateTo, qty: r.qty });

  /* Колонка «срок» отвечает на вопрос «что по времени?» у каждого живого
   * статуса, а не только у новой заявки. Новая живёт таймером протухания —
   * его рисует клиент от expiresAt. Подтверждённой протухать нечему, но срок
   * у неё есть: когда начнётся. Идущая — «идёт». Закрытым и просроченным
   * сказать нечего: у первых всё позади, у вторых говорит бейдж. */
  let deadline: string | null = null;
  if (r.status === "confirmed" && !overdue) {
    const untilStart = daysBetween(today, r.dateFrom);
    // «старт:» обязателен — голое «через 8 дней» не говорило, что именно
    // наступит. У новой заявки контекст держит соседний бейдж, здесь его нет.
    // «дн.» с точкой — как «за 2 дн.» в виджете брони: склонение не влезало.
    deadline = untilStart > 0 ? `старт: ${untilStart} дн.` : "идёт";
  }

  return {
    ...r,
    // Date через границу RSC проходит, но строка честнее: клиенту нужны только
    // вывод и сравнение, а несериализуемого в пропсах лучше не держать.
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    hot,
    overdue,
    estimate: days > 0 ? r.listing.priceDay * days * r.qty : null,
    deadline,
  };
}

/* Вес строки: сперва то, что требует действия, затем идущее, закрытые позади.
 * Внутри веса — свежие выше. Сортировка в JS, а не в SQL: правило читается
 * рядом с лентой, а строк у человека десятки, не тысячи. */
export function sortFeedRows(rows: FeedRow[]): FeedRow[] {
  const weight = (r: FeedRow) =>
    r.hot || r.overdue ? 0 : r.status === "new" || r.status === "confirmed" ? 1 : 2;
  return [...rows].sort(
    (a, b) => weight(a) - weight(b) || (a.createdAt < b.createdAt ? 1 : -1),
  );
}
