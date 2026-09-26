// Расчёт итога и ранжирование предложений прокатов.
// Чистые функции без зависимостей: подключаются к данным из Drizzle как есть.
// Суммы — целые рубли.

export type Rub = number;

export interface OfferInput {
  id: string;
  shopId: string;
  shopName: string;
  itemClassId: string;
  model?: string | null;
  district: string;
  priceDay: Rub;
  /** Цена за 7 суток, если у проката есть недельный тариф. */
  priceWeek?: Rub | null;
  /** Минимальный оплачиваемый срок, суток. */
  minDays: number;
  /** Денежный залог, ₽. null — залог неизвестен («уточняется»). 0 — денежного залога нет. */
  depositRub: Rub | null;
  /** Берут паспорт/документ в залог. */
  depositDocument: boolean;
  delivery: {
    available: boolean;
    price: Rub;
    /** Доставка бесплатна, если аренда не меньше этой суммы. */
    freeFrom?: Rub | null;
    /** Могут привезти в день заказа. */
    sameDay: boolean;
  };
  /** Когда цену последний раз проверили (звонок, сайт или сам прокат). */
  verifiedAt: Date;
  /** Прокат подтвердил карточку. */
  claimed: boolean;
}

export interface Scenario {
  /** Число суток аренды. Из диапазона дат — через rentalDays(). */
  days: number;
  needDelivery: boolean;
}

export interface Quote {
  offer: OfferInput;
  billedDays: number;
  rent: Rub;
  deliveryFee: Rub;
  total: Rub;
  /** Минимальный срок больше запрошенного — платим за минимум. */
  minApplied: boolean;
}

export const STALE_AFTER_DAYS = 30;
const DAY_MS = 86_400_000;

/** Суток между датами получения и возврата: сб 27 → пн 29 = 2 суток. Минимум 1. */
export function rentalDays(from: Date, to: Date): number {
  const d = Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
  return Math.max(1, d);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Стоимость аренды за N суток с учётом недельного тарифа. */
export function rentFor(offer: OfferInput, days: number): Rub {
  const { priceDay, priceWeek } = offer;
  if (priceWeek && days >= 7) {
    const weeks = Math.floor(days / 7);
    const rest = days % 7;
    return weeks * priceWeek + Math.min(rest * priceDay, priceWeek);
  }
  return days * priceDay;
}

/** Итог по одному предложению. null — предложение не подходит (нужна доставка, а её нет). */
export function quote(offer: OfferInput, s: Scenario): Quote | null {
  if (s.needDelivery && !offer.delivery.available) return null;
  const billedDays = Math.max(s.days, offer.minDays);
  const rent = rentFor(offer, billedDays);
  let deliveryFee = 0;
  if (s.needDelivery) {
    const free = offer.delivery.freeFrom != null && rent >= offer.delivery.freeFrom;
    deliveryFee = free ? 0 : offer.delivery.price;
  }
  return { offer, billedDays, rent, deliveryFee, total: rent + deliveryFee, minApplied: billedDays > s.days };
}

export function isStale(offer: OfferInput, today: Date, maxAgeDays = STALE_AFTER_DAYS): boolean {
  return (startOfDay(today).getTime() - startOfDay(offer.verifiedAt).getTime()) / DAY_MS > maxAgeDays;
}

export function hasMoneyDeposit(offer: OfferInput): boolean {
  return offer.depositRub != null && offer.depositRub > 0;
}

export interface Ranking {
  /** Участвуют в рейтинге: свежая цена и подходят под сценарий. По возрастанию итога. */
  ranked: Quote[];
  /** Цена старше 30 дней — показываем отдельно, в рейтинг не ставим. */
  recheck: Quote[];
  /** Нужна доставка, а прокат только на самовывоз. Итог — как при самовывозе. */
  pickupOnly: Quote[];
}

const byTotal = (a: Quote, b: Quote) =>
  a.total - b.total || a.offer.priceDay - b.offer.priceDay || Number(b.offer.claimed) - Number(a.offer.claimed);

export function rank(offers: OfferInput[], s: Scenario, today: Date): Ranking {
  const ranked: Quote[] = [];
  const recheck: Quote[] = [];
  const pickupOnly: Quote[] = [];
  for (const o of offers) {
    const q = quote(o, s);
    if (!q) {
      const pickup = quote(o, { ...s, needDelivery: false });
      if (pickup) pickupOnly.push(pickup);
      continue;
    }
    (isStale(o, today) ? recheck : ranked).push(q);
  }
  return { ranked: ranked.sort(byTotal), recheck: recheck.sort(byTotal), pickupOnly: pickupOnly.sort(byTotal) };
}

export type TabId = "cheapest" | "noMoneyDeposit" | "sameDay";

export const TABS: { id: TabId; label: string; winnerLabel: string; test: (q: Quote) => boolean }[] = [
  { id: "cheapest", label: "Самый дешёвый", winnerLabel: "Самый дешёвый за ваши даты", test: () => true },
  {
    id: "noMoneyDeposit",
    label: "Без денежного залога",
    winnerLabel: "Без денежного залога — дешевле всех",
    // Только явный ноль. Залог «уточняется» (null) не считаем отсутствием залога.
    // Паспорт в залог допустим: это не деньги.
    test: (q) => q.offer.depositRub === 0,
  },
  { id: "sameDay", label: "Привезут сегодня", winnerLabel: "Сегодня — дешевле всех", test: (q) => q.offer.delivery.sameDay },
];

/** Список для вкладки: фильтр вкладки поверх ранжирования. */
export function tabList(r: Ranking, tab: TabId): Quote[] {
  const t = TABS.find((x) => x.id === tab)!;
  return r.ranked.filter(t.test);
}

/** Минимальный итог при условии — для цен у фильтров («Без денежного залога — от 1 350 ₽»). */
export function minTotal(quotes: Quote[], where: (q: Quote) => boolean = () => true): Rub | null {
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
 * Подсказка «возьмите на неделю»: показываем, если срок меньше 7 суток и недельный тариф
 * дешевле 7 × суточной цены хотя бы на 10%. Берём самую низкую недельную цену
 * (при равенстве — с большей экономией): человеку важен итог, а не процент скидки.
 */
export function weekSavingsHint(r: Ranking, s: Scenario, minShare = 0.1): SavingsHint | null {
  if (s.days >= 7) return null;
  let best: SavingsHint | null = null;
  for (const q of r.ranked) {
    const w = q.offer.priceWeek;
    if (!w) continue;
    const daily = 7 * q.offer.priceDay;
    const saving = daily - w;
    if (saving < daily * minShare) continue;
    if (!best || w < best.weekPrice || (w === best.weekPrice && saving > best.saving)) {
      best = { offer: q.offer, weekPrice: w, dailyEquivalent: daily, saving };
    }
  }
  return best;
}

/** Формат суммы: 1 300 ₽ (неразрывные пробелы). */
export function formatRub(n: Rub): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽";
}
