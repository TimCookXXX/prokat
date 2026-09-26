// Вопросы и ответы страницы сравнения — свой текст страницы (без чужих текстов
// и фото). Ответы собираются из фактических предложений класса, поэтому их можно
// отдать и в разметку, и в JSON-LD FAQPage.

import { formatRub, isStale, quote, type OfferInput } from "@/lib/compare/pricing";
import { shopsGenitive } from "@/lib/compare/format";
import { ruPlural } from "@/lib/plural";

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
    const totals = fresh.map((o) => quote(o, 1).total);
    const parts = [
      dayPrices.length
        ? `Суточная цена — от ${formatRub(Math.min(...dayPrices))} у ${shopsGenitive(shops)} ${cityIn}.`
        : `Сдают понедельно: от ${formatRub(Math.min(...fresh.map((o) => o.priceWeek ?? Infinity)))} за неделю.`,
    ];
    if (totals.length) {
      parts.push(`Итог за 1 сутки — от ${formatRub(Math.min(...totals))}: мы сразу учитываем минимальный срок и недельный тариф проката.`);
    }
    items.push({ q: `Сколько стоит ${title.toLowerCase()} ${cityIn}?`, a: parts.join(" ") });

    const noMoney = fresh.filter((o) => o.depositRub === 0);
    const withMoney = fresh.map((o) => o.depositRub).filter((d): d is number => d != null && d > 0);
    const unknown = fresh.filter((o) => o.depositRub == null).length;
    const dep: string[] = [];
    dep.push(noMoney.length
      ? `Без денежного залога — ${noMoney.length} из ${fresh.length} ${ruPlural(fresh.length, "предложения", "предложений", "предложений")}${noMoney.some((o) => o.depositDocument) ? " (часть просит паспорт)" : ""}.`
      : "Все прокаты с известными условиями просят денежный залог.");
    if (withMoney.length) {
      dep.push(`Денежный залог — от ${formatRub(Math.min(...withMoney))} до ${formatRub(Math.max(...withMoney))}, его возвращают после аренды. В итог он не входит.`);
    }
    if (unknown) dep.push(`У ${unknown} ${ruPlural(unknown, "предложения", "предложений", "предложений")} залог уточняем.`);
    items.push({ q: "Нужен ли залог?", a: dep.join(" ") });

    const delivers = new Set(fresh.filter((o) => o.delivery.available).map((o) => o.shopId)).size;
    items.push({
      q: "Как выбрать прокат поближе?",
      a: "Укажите в поле «Где» микрорайон или адрес — покажем расстояние и время в пути до каждого проката. "
        + "Вкладка «Оптимальный» учитывает и цену, и дорогу: забрать и вернуть — это четыре поездки."
        + (delivers ? ` Доставка есть у ${shopsGenitive(delivers)} — её условия уточняйте у проката, в итог она не входит.` : ""),
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
