// Параметры страницы сравнения живут в query-строке: ссылка открывает ту же выдачу.
// Разбор терпим к мусору — неверное значение заменяется значением по умолчанию,
// а не ломает страницу.
//
//   c        класс внутри группы (slug)          по умолчанию — первый класс группы
//   m        модель или бренд из поиска          все модели
//   from,to  даты «когда», YYYY-MM-DD              завтра → послезавтра (1 сутки)
//   pickup=1 заберу сам (иначе — привезти)
//   tab      cheapest | noMoneyDeposit | sameDay  cheapest
//   nodep, today, claimed, min1 = 1                фильтры
//   area     районы прокатов через запятую

import { addDaysStr } from "@/lib/catalog/dates";
import { rentalDays, type TabId } from "@/lib/compare/pricing";

export const MAX_RENTAL_DAYS = 90;
/** Насколько вперёд можно выбрать дату начала. */
export const DATE_HORIZON_DAYS = 180;

const TAB_IDS: readonly TabId[] = ["cheapest", "noMoneyDeposit", "sameDay"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CompareFilters {
  /** Без денежного залога (явный 0; паспорт допустим). */
  noMoneyDeposit: boolean;
  /** Привезут в день заказа. */
  sameDay: boolean;
  /** Прокат подтвердил цены. */
  claimed: boolean;
  /** Сдаёт от 1 суток. */
  oneDay: boolean;
  /** Районы прокатов; пусто — любые. */
  areas: string[];
}

export interface CompareParams {
  classSlug: string | null;
  /** Только эта модель или все модели бренда («Makita»); null — все. */
  model: string | null;
  from: string;
  to: string;
  days: number;
  pickup: boolean;
  tab: TabId;
  filters: CompareFilters;
}

type RawParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function flag(v: string | string[] | undefined): boolean {
  return one(v) === "1";
}

function validDate(s: string | undefined): s is string {
  if (!s || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Сегодня по местному времени городов сервиса (Краснодар — UTC+3, как Москва). */
export function localToday(now: Date = new Date(), timeZone = "Europe/Moscow"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function defaultDates(today: string): { from: string; to: string } {
  const from = addDaysStr(today, 1);
  return { from, to: addDaysStr(from, 1) };
}

export function parseCompareParams(sp: RawParams, today: string): CompareParams {
  const def = defaultDates(today);
  let from = one(sp.from);
  let to = one(sp.to);
  const lastStart = addDaysStr(today, DATE_HORIZON_DAYS);
  if (!validDate(from) || from < today || from > lastStart) from = def.from;
  if (!validDate(to) || to < from) to = addDaysStr(from, 1);
  if (rentalDays(from, to) > MAX_RENTAL_DAYS) to = addDaysStr(from, MAX_RENTAL_DAYS);

  const tab = one(sp.tab);
  const area = one(sp.area);
  const text = (v: string | undefined) => {
    const t = v?.trim();
    return t ? t.slice(0, 80) : null;
  };

  return {
    classSlug: text(one(sp.c)),
    model: text(one(sp.m)),
    from,
    to,
    days: rentalDays(from, to),
    pickup: flag(sp.pickup),
    tab: TAB_IDS.includes(tab as TabId) ? (tab as TabId) : "cheapest",
    filters: {
      noMoneyDeposit: flag(sp.nodep),
      sameDay: flag(sp.today),
      claimed: flag(sp.claimed),
      oneDay: flag(sp.min1),
      areas: area ? [...new Set(area.split(",").map((a) => a.trim()).filter(Boolean))].slice(0, 20) : [],
    },
  };
}

/** Query-строка для параметров (без «?»). Значения по умолчанию опускаются. */
export function compareQuery(p: CompareParams): string {
  const q = new URLSearchParams();
  if (p.classSlug) q.set("c", p.classSlug);
  if (p.model) q.set("m", p.model);
  q.set("from", p.from);
  q.set("to", p.to);
  if (p.pickup) q.set("pickup", "1");
  if (p.tab !== "cheapest") q.set("tab", p.tab);
  if (p.filters.noMoneyDeposit) q.set("nodep", "1");
  if (p.filters.sameDay) q.set("today", "1");
  if (p.filters.claimed) q.set("claimed", "1");
  if (p.filters.oneDay) q.set("min1", "1");
  if (p.filters.areas.length) q.set("area", p.filters.areas.join(","));
  return q.toString();
}

export type ParamsPatch = Partial<Omit<CompareParams, "filters" | "days">> & { filters?: Partial<CompareFilters> };

export function patchParams(p: CompareParams, patch: ParamsPatch): CompareParams {
  const from = patch.from ?? p.from;
  const to = patch.to ?? p.to;
  return {
    ...p,
    ...patch,
    from,
    to,
    days: rentalDays(from, to),
    filters: { ...p.filters, ...patch.filters },
  };
}

/**
 * Клик по дню в календаре «Когда». Первый клик — один день, второй — второй конец
 * периода в любом порядке (26, потом 24 → 24–26); после готового периода клик
 * начинает выбор заново. Второй конец не дальше MAX_RENTAL_DAYS.
 */
export function pickRangeDay(sel: { from: string | null; to: string | null }, day: string): { from: string; to: string | null } {
  if (!sel.from || sel.to) return { from: day, to: null };
  const from = day < sel.from ? day : sel.from;
  let to = day < sel.from ? sel.from : day;
  if (rentalDays(from, to) > MAX_RENTAL_DAYS) to = addDaysStr(from, MAX_RENTAL_DAYS);
  return { from, to };
}

export function comparePath(citySlug: string, groupSlug: string): string {
  return `/${citySlug}/${groupSlug}`;
}

export function compareHref(citySlug: string, groupSlug: string, p: CompareParams): string {
  return `${comparePath(citySlug, groupSlug)}?${compareQuery(p)}`;
}

/** Сколько фильтров боковой панели включено — для кнопки «Фильтры · N». */
export function activeFilterCount(f: CompareFilters): number {
  return [f.noMoneyDeposit, f.sameDay, f.claimed, f.oneDay].filter(Boolean).length + f.areas.length;
}
