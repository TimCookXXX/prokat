// Расстояние, оценка и порядок в выдаче (ТЗ, пп. 4.3–4.4, 5.2–5.3).
// На входе — итоги (pricing.ts), местоположение пользователя и проката; на выходе —
// списки вкладок, вкладка по умолчанию и пояснение под первым предложением.

import {
  LOW_SPREAD_SHARE, MINUTE_COST_RUB, TRIPS_PER_RENTAL,
} from "@/lib/compare/config";
import { ageDays, formatRub, type OfferInput, type Quote, type Rub } from "@/lib/compare/pricing";
import { tripBetween, type GeoPoint, type Trip, type UserLocation } from "@/lib/compare/geo";
import { ruPlural } from "@/lib/plural";

export interface Placed extends Quote {
  /** Путь от пользователя до проката; null — нет точки у одного из них. */
  trip: Trip | null;
  /** Округ проката (slug); null — неизвестен. */
  okrug: string | null;
  /** Оценка для «Оптимального»: итог + 4 поездки × минуты × стоимость минуты. */
  score: Rub;
  /** Дней с проверки цены — при прочих равных свежее выше. */
  age: number;
}

export type TabId = "optimal" | "cheapest" | "nearest" | "okrug";

export interface PlaceInput {
  /** Точка пользователя (null — город или округ). */
  user: { point: GeoPoint; approx: boolean } | null;
  /** Точка проката предложения (null — адрес и микрорайон неизвестны). */
  shopPoint: (o: OfferInput) => { point: GeoPoint; approx: boolean } | null;
  shopOkrug: (o: OfferInput) => string | null;
  today: string;
}

export function place(quotes: Quote[], ctx: PlaceInput): Placed[] {
  return quotes.map((q) => {
    const sp = ctx.user ? ctx.shopPoint(q.offer) : null;
    const trip = ctx.user && sp ? tripBetween(ctx.user.point, sp.point, ctx.user.approx || sp.approx) : null;
    return {
      ...q,
      trip,
      okrug: ctx.shopOkrug(q.offer),
      score: q.total + (trip ? TRIPS_PER_RENTAL * trip.minutes * MINUTE_COST_RUB : 0),
      age: ageDays(q.offer, ctx.today),
    };
  });
}

// ------------------------------------------------------------ вкладки

export const TAB_LABELS: Record<TabId, { label: string; short: string; winner: string }> = {
  optimal: { label: "Оптимальный", short: "Оптимальный", winner: "Оптимально по цене и дороге" },
  cheapest: { label: "Самый дешёвый", short: "Дешевле всех", winner: "Самый дешёвый за ваши даты" },
  nearest: { label: "Ближе всего", short: "Ближе всех", winner: "Ближе всего к вам" },
  okrug: { label: "Сначала в вашем округе", short: "В округе", winner: "Дешевле всех в вашем округе" },
};

/** Вкладки по типу местоположения: у города и округа нет «Ближе всего». */
export function tabsFor(kind: UserLocation["kind"]): TabId[] {
  if (kind === "city") return ["optimal", "cheapest"];
  if (kind === "okrug") return ["optimal", "cheapest", "okrug"];
  return ["optimal", "cheapest", "nearest"];
}

const dist = (p: Placed) => p.trip?.km ?? Infinity;

// При прочих равных выше подтверждённый прокат, затем более свежая проверка цены.
const tie = (a: Placed, b: Placed) =>
  Number(b.offer.claimed) - Number(a.offer.claimed) || a.age - b.age || a.offer.id.localeCompare(b.offer.id);

// Предложения без местоположения — после предложений с ним (когда расстояния вообще есть).
const locatedFirst = (a: Placed, b: Placed) => Number(a.trip === null) - Number(b.trip === null);

export function sortForTab(list: Placed[], tab: TabId, userOkrug: string | null): Placed[] {
  const withDistances = list.some((p) => p.trip !== null);
  const cheapest = (a: Placed, b: Placed) => a.total - b.total || dist(a) - dist(b) || tie(a, b);
  const cmp: Record<TabId, (a: Placed, b: Placed) => number> = {
    cheapest,
    optimal: (a, b) => (withDistances ? locatedFirst(a, b) : 0) || a.score - b.score || a.total - b.total || tie(a, b),
    nearest: (a, b) => locatedFirst(a, b) || dist(a) - dist(b) || a.total - b.total || tie(a, b),
    okrug: (a, b) => Number(b.okrug === userOkrug) - Number(a.okrug === userOkrug) || cheapest(a, b),
  };
  const sorted = [...list].sort(cmp[tab]);
  // Без расстояний доминирование сводится к «дешевле» — на вкладке округа оно
  // вытащило бы вперёд прокат из другого округа. Сравниваем внутри групп.
  if (tab === "okrug") {
    const own = sorted.filter((p) => p.okrug === userOkrug);
    const rest = sorted.filter((p) => p.okrug !== userOkrug);
    return [...undominatedFirst(own), ...undominatedFirst(rest)];
  }
  return undominatedFirst(sorted);
}

/** a не хуже b ни по итогу, ни по расстоянию и лучше хотя бы по одному. */
export function dominates(a: Placed, b: Placed): boolean {
  const da = dist(a);
  const db = dist(b);
  return a.total <= b.total && da <= db && (a.total < b.total || da < db);
}

/**
 * Первым не может стоять предложение, которое дороже и дальше другого (ТЗ, п. 5.2):
 * если первое доминируется, вперёд выходит первое недоминируемое из списка.
 */
export function undominatedFirst(sorted: Placed[]): Placed[] {
  if (sorted.length < 2) return sorted;
  const free = sorted.findIndex((p) => !sorted.some((q) => q !== p && dominates(q, p)));
  if (free <= 0) return sorted;
  return [sorted[free], ...sorted.slice(0, free), ...sorted.slice(free + 1)];
}

/**
 * Вкладка по умолчанию: итоги почти одинаковые (разброс < LOW_SPREAD_SHARE) и
 * расстояния известны — «Ближе всего»; иначе «Оптимальный».
 */
export function defaultTab(list: Placed[], available: TabId[]): TabId {
  if (available.includes("nearest") && list.length > 1 && list.some((p) => p.trip)) {
    const totals = list.map((p) => p.total);
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    if (min > 0 && (max - min) / min < LOW_SPREAD_SHARE) return "nearest";
  }
  return "optimal";
}

// ------------------------------------------------------------ пояснение

function timesText(ratio: number): string {
  const r = Math.round(ratio * 2) / 2; // до половины: «в 1,5 раза», «в 3 раза»
  const n = r.toLocaleString("ru-RU");
  return `в ${n} ${Number.isInteger(r) ? ruPlural(r, "раз", "раза", "раз") : "раза"}`;
}

/**
 * Чем первое предложение вкладки лучше альтернатив: «На 100 ₽ дороже самого
 * дешёвого, но в 3 раза ближе», «Самый дешёвый, 20 мин в одну сторону».
 */
export function explainFirst(sorted: Placed[], tab: TabId, userOkrug: string | null): string | null {
  const first = sorted[0];
  if (!first) return null;
  const cheapest = sorted.reduce((m, p) => (p.total < m.total || (p.total === m.total && dist(p) < dist(m)) ? p : m), first);
  const way = first.trip ? `${first.trip.approx ? "≈ " : ""}${Math.max(1, first.trip.minutes)} мин в одну сторону` : null;

  if (tab === "okrug" && first.okrug === userOkrug) {
    const diff = first.total - cheapest.total;
    return diff > 0 ? `Дешевле всех в вашем округе; в городе есть на ${formatRub(diff)} дешевле` : "Дешевле всех в вашем округе и в городе";
  }
  if (first.total <= cheapest.total) {
    if (tab === "nearest") return "Ближе всего и дешевле всех";
    // Без расстояний «самый дешёвый» уже сказано подписью победителя.
    return way ? `Самый дешёвый, ${way}` : null;
  }
  const diff = formatRub(first.total - cheapest.total);
  if (first.trip && cheapest.trip) {
    const gap = cheapest.trip.km - first.trip.km;
    const ratio = first.trip.km > 0 ? cheapest.trip.km / first.trip.km : Infinity;
    if (gap >= 0.5) {
      // «В 28 раз ближе» (и «в ∞ раз», когда прокат в центре того же микрорайона)
      // звучит странно — при большой разнице говорим, насколько рядом.
      if (first.trip.km < 0.5 || ratio > 5) {
        const near = first.trip.km < 1 ? "меньше километра от вас" : `${first.trip.approx ? "≈ " : ""}${Math.round(first.trip.km)} км от вас`;
        return `На ${diff} дороже самого дешёвого, но всего ${near}`;
      }
      if (ratio >= 1.5) return `На ${diff} дороже самого дешёвого, но ${timesText(ratio)} ближе`;
      return `На ${diff} дороже самого дешёвого, но на ${(Math.round(gap * 10) / 10).toLocaleString("ru-RU")} км ближе`;
    }
  }
  if (tab === "nearest" && way) return `Ближе всего — ${way}; на ${diff} дороже самого дешёвого`;
  return `На ${diff} дороже самого дешёвого`;
}
