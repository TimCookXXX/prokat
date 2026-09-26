// Вопросы и ответы страницы сравнения — свой текст страницы (без чужих текстов
// и фото). Ответы собираются из фактических предложений класса, поэтому их можно
// отдать и в разметку, и в JSON-LD FAQPage.

import { formatRub, isStale, quote, type OfferInput } from "@/lib/compare/pricing";
import { shopsGenitive } from "@/lib/compare/format";

export interface FaqItem { q: string; a: string }

export function buildFaq({
  title, offers, today, cityIn,
}: {
  /** «Прокат перфоратора» — без города. */
  title: string;
  offers: OfferInput[];
  today: string;
  /** «в Краснодаре» */
  cityIn: string;
}): FaqItem[] {
  const fresh = offers.filter((o) => !isStale(o, today));
  const shops = new Set(fresh.map((o) => o.shopId)).size;
  const items: FaqItem[] = [];

  if (fresh.length) {
    const dayPrices = fresh.map((o) => o.priceDay).filter((p): p is number => p != null);
    const totals = fresh
      .map((o) => quote(o, { days: 1, needDelivery: true }))
      .filter((q) => q !== null)
      .map((q) => q.total);
    const parts = [
      dayPrices.length
        ? `Суточная цена — от ${formatRub(Math.min(...dayPrices))} у ${shopsGenitive(shops)} ${cityIn}.`
        : `Сдают понедельно: от ${formatRub(Math.min(...fresh.map((o) => o.priceWeek ?? Infinity)))} за неделю.`,
    ];
    if (totals.length) {
      parts.push(`Итог за 1 сутки с доставкой — от ${formatRub(Math.min(...totals))}: мы сразу добавляем доставку и учитываем минимальный срок проката.`);
    }
    items.push({ q: `Сколько стоит ${title.toLowerCase()} ${cityIn}?`, a: parts.join(" ") });

    const noMoney = fresh.filter((o) => o.depositRub === 0);
    const withMoney = fresh.map((o) => o.depositRub).filter((d): d is number => d != null && d > 0);
    const unknown = fresh.filter((o) => o.depositRub == null).length;
    const dep: string[] = [];
    dep.push(noMoney.length
      ? `Без денежного залога — ${noMoney.length} из ${fresh.length} предложений${noMoney.some((o) => o.depositDocument) ? " (часть просит паспорт)" : ""}.`
      : "Все прокаты с известными условиями просят денежный залог.");
    if (withMoney.length) {
      dep.push(`Денежный залог — от ${formatRub(Math.min(...withMoney))} до ${formatRub(Math.max(...withMoney))}, его возвращают после аренды. В итог он не входит.`);
    }
    if (unknown) dep.push(`У ${unknown} залог уточняем.`);
    items.push({ q: "Нужен ли залог?", a: dep.join(" ") });

    const sameDay = new Set(fresh.filter((o) => o.delivery.available && o.delivery.sameDay).map((o) => o.shopId)).size;
    items.push({
      q: "Можно привезти сегодня?",
      a: sameDay
        ? `Доставка в день заказа есть у ${shopsGenitive(sameDay)} — смотрите вкладку «Привезут сегодня».`
        : "Пока никто из прокатов не обещает доставку в день заказа — лучше заказывать заранее.",
    });
  }

  items.push({
    q: "Откуда цены и насколько они свежие?",
    a: "Цены собираем сами: звонком, на сайте проката или по его объявлению. У каждой цены на карточке дата проверки. Цены старше 30 дней не участвуют в сравнении, пока мы их не перепроверим.",
  });
  items.push({
    q: "Как платить и оформлять аренду?",
    a: "Напрямую с прокатом: inrenta не берёт оплату и не держит залоги. Нажмите «Показать телефон» и скажите, что нашли цену на inrenta.",
  });
  return items;
}
