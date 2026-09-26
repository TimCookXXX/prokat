// Расчёт итога предложения — единственное место, где считается итог (ТЗ, п. 4.1;
// эталон: docs/inrenta-pivot/code/pricing.ts). В версии 1 только самовывоз:
// доставка хранится и показывается справочно, но в итог не входит.
// Чистые функции без БД. Суммы — целые рубли, даты — строки YYYY-MM-DD
// (календарные дни, как в lib/catalog/dates: от часового пояса сервера не зависят).
//
// Срок пользователь задаёт датами «когда», число суток считается из них. Тарифы
// проката — суточный и недельный; прокат может сдавать только понедельно
// (priceDay = null) — тогда оплачиваются целые недели.

import { formatPrice } from "@/lib/catalog/format";
import { STALE_AFTER_DAYS, WEEK_HINT_MIN_SHARE } from "@/lib/compare/config";

export { STALE_AFTER_DAYS } from "@/lib/compare/config";

export type Rub = number;

export interface OfferInput {
  id: string;
  shopId: string;
  shopName: string;
  itemClassId: string;
  model?: string | null;
  district: string;
  /** Цена за сутки. null — прокат сдаёт только понедельно. */
  priceDay: Rub | null;
  /** Цена за 7 суток, если у проката есть недельный тариф. */
  priceWeek?: Rub | null;
  /** Минимальный оплачиваемый срок, суток. */
  minDays: number;
  /** Денежный залог, ₽. null — залог неизвестен («уточняется»). 0 — денежного залога нет. */
  depositRub: Rub | null;
  /** Берут паспорт/документ в залог. */
  depositDocument: boolean;
  /** Условия доставки — справочно («Есть доставка — уточняйте у проката»), в итог не входят. */
  delivery: {
    available: boolean;
    price: Rub;
    /** Доставка бесплатна, если аренда не меньше этой суммы. */
    freeFrom?: Rub | null;
    /** Могут привезти в день заказа. */
    sameDay: boolean;
  };
  /** Когда цену последний раз проверили (звонок, сайт или сам прокат), YYYY-MM-DD. */
  verifiedAt: string;
  /** Прокат подтвердил карточку. */
  claimed: boolean;
}

export interface Quote {
  offer: OfferInput;
  /** Запрошенные сутки. */
  days: number;
  /** Оплачиваемые сутки: max(запрошенные, минимальный срок); у понедельных — целые недели. */
  billedDays: number;
  total: Rub;
  /** Оплачиваемый срок больше запрошенного: минимальный срок или целые недели. */
  minApplied: boolean;
}

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

/** Суток между датами получения и возврата: сб 27 → пн 29 = 2 суток. Минимум 1. */
export function rentalDays(from: string, to: string): number {
  return Math.max(1, Math.round(dayNumber(to) - dayNumber(from)));
}

/** Стоимость аренды за N суток с учётом недельного тарифа. */
export function rentFor(offer: OfferInput, days: number): Rub {
  const { priceDay, priceWeek } = offer;
  if (priceDay == null) {
    if (!priceWeek) throw new Error(`offer ${offer.id}: no day or week price`);
    return Math.ceil(days / 7) * priceWeek;
  }
  if (priceWeek && days >= 7) {
    const weeks = Math.floor(days / 7);
    const rest = days % 7;
    return weeks * priceWeek + Math.min(rest * priceDay, priceWeek);
  }
  return days * priceDay;
}

/** Итог по одному предложению за `days` суток. */
export function quote(offer: OfferInput, days: number): Quote {
  let billedDays = Math.max(days, offer.minDays);
  if (offer.priceDay == null) billedDays = Math.ceil(billedDays / 7) * 7;
  return { offer, days, billedDays, total: rentFor(offer, billedDays), minApplied: billedDays > days };
}

/** @param today YYYY-MM-DD */
export function isStale(offer: OfferInput, today: string, maxAgeDays = STALE_AFTER_DAYS): boolean {
  return dayNumber(today) - dayNumber(offer.verifiedAt) > maxAgeDays;
}

/** Дней с проверки цены — для сортировки «свежее выше». */
export function ageDays(offer: OfferInput, today: string): number {
  return dayNumber(today) - dayNumber(offer.verifiedAt);
}

export function hasMoneyDeposit(offer: OfferInput): boolean {
  return offer.depositRub != null && offer.depositRub > 0;
}

export interface Priced {
  /** Свежие цены — участвуют в рейтинге. По возрастанию итога. */
  fresh: Quote[];
  /** Цена старше STALE_AFTER_DAYS — блок «на перепроверке», в рейтинг и вкладки не входит. */
  recheck: Quote[];
}

/** Цена суток для равных итогов: у понедельного проката — седьмая часть недели. */
const dayRate = (o: OfferInput) => o.priceDay ?? (o.priceWeek ?? 0) / 7;

export const byTotal = (a: Quote, b: Quote) =>
  a.total - b.total || dayRate(a.offer) - dayRate(b.offer) || Number(b.offer.claimed) - Number(a.offer.claimed);

/** @param today YYYY-MM-DD */
export function priceAll(offers: OfferInput[], days: number, today: string): Priced {
  const fresh: Quote[] = [];
  const recheck: Quote[] = [];
  for (const o of offers) (isStale(o, today) ? recheck : fresh).push(quote(o, days));
  return { fresh: fresh.sort(byTotal), recheck: recheck.sort(byTotal) };
}

/** Минимальный итог при условии — для цен у фильтров («Без денежного залога — от 1 350 ₽»). */
export function minTotal<Q extends Quote>(quotes: Q[], where: (q: Q) => boolean = () => true): Rub | null {
  let min: Rub | null = null;
  for (const q of quotes) if (where(q) && (min === null || q.total < min)) min = q.total;
  return min;
}

export interface SavingsHint {
  offer: OfferInput;
  weekPrice: Rub;
  dailyEquivalent: Rub;
  saving: Rub;
}

/**
 * Подсказка «возьмите на неделю» (ТЗ, п. 5.7): срок меньше 7 суток, а недельный тариф
 * дешевле 7 × суточной цены хотя бы на WEEK_HINT_MIN_SHARE. Берём самую низкую
 * недельную цену (при равенстве — с большей экономией). Понедельные прокаты
 * (без суточной цены) не участвуют — сравнивать не с чем.
 */
export function weekSavingsHint(quotes: Quote[], days: number, minShare = WEEK_HINT_MIN_SHARE): SavingsHint | null {
  if (days >= 7) return null;
  let best: SavingsHint | null = null;
  for (const q of quotes) {
    const w = q.offer.priceWeek;
    if (!w || q.offer.priceDay == null) continue;
    const daily = 7 * q.offer.priceDay;
    const saving = daily - w;
    if (saving < daily * minShare) continue;
    if (!best || w < best.weekPrice || (w === best.weekPrice && saving > best.saving)) {
      best = { offer: q.offer, weekPrice: w, dailyEquivalent: daily, saving };
    }
  }
  return best;
}

/** Формат суммы: 1 300 ₽ (неразрывные пробелы). Тот же, что во всём проекте. */
export const formatRub: (n: Rub) => string = formatPrice;
