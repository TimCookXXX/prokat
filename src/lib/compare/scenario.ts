// Параметры выдачи живут в query-строке (ТЗ, п. 6): ссылка открывает ту же выдачу.
// Разбор терпим к мусору — неверное значение заменяется значением по умолчанию,
// а не ломает страницу.
//
//   c        класс внутри группы (slug)                 все классы группы
//   brand    бренд (slug)                               все бренды
//   model    модели через запятую (slug)                все модели
//   from,to  даты «когда», YYYY-MM-DD                   нет — сегодня на 1 сутки (с пометкой)
//   loc      где: d:<микрорайон> | o:<округ> | p:<lat>,<lon>   город
//   la, src  подпись точки и её источник (geo)
//   tab      optimal | cheapest | nearest | okrug       по правилу вкладки по умолчанию
//   nodep, claimed, min1, open = 1                      фильтры
//   okrug    округа прокатов через запятую

import { addDaysStr } from "@/lib/catalog/dates";
import { rentalDays } from "@/lib/compare/pricing";
import { CITY_LOCATION, locationQuery, parseLocation, type CityGeo, type UserLocation } from "@/lib/compare/geo";
import type { TabId } from "@/lib/compare/ranking";
import type { SearchTarget } from "@/lib/compare/search";

export const MAX_RENTAL_DAYS = 90;
/** Насколько вперёд можно выбрать дату начала. */
export const DATE_HORIZON_DAYS = 180;

const TAB_IDS: readonly TabId[] = ["optimal", "cheapest", "nearest", "okrug"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9-]{1,120}$/;

export interface ResultFilters {
  /** Без денежного залога (явный 0; паспорт допустим). */
  noMoneyDeposit: boolean;
  /** Прокат подтвердил цены. */
  claimed: boolean;
  /** Сдаёт от 1 суток. */
  oneDay: boolean;
  /** Работает сегодня (по часам работы). */
  openToday: boolean;
  /** Модели (slug); пусто — любые, включая предложения без модели. */
  models: string[];
  /** Округа прокатов (slug); пусто — любые. */
  okrugs: string[];
}

export const NO_FILTERS: ResultFilters = {
  noMoneyDeposit: false, claimed: false, oneDay: false, openToday: false, models: [], okrugs: [],
};

export interface ResultParams {
  classSlug: string | null;
  brandSlug: string | null;
  from: string;
  to: string;
  days: number;
  /** Даты выбраны человеком; нет — считаем «сегодня на 1 сутки» с пометкой. */
  datesGiven: boolean;
  loc: UserLocation;
  /** null — вкладка по умолчанию (ranking.defaultTab). */
  tab: TabId | null;
  filters: ResultFilters;
}

type RawParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function flag(v: string | string[] | undefined): boolean {
  return one(v) === "1";
}

function slugList(v: string | string[] | undefined, max = 20): string[] {
  const s = one(v);
  return s ? [...new Set(s.split(",").map((x) => x.trim()).filter((x) => SLUG_RE.test(x)))].slice(0, max) : [];
}

function slug(v: string | string[] | undefined): string | null {
  const s = one(v)?.trim();
  return s && SLUG_RE.test(s) ? s : null;
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

/** Даты не выбраны: сегодня на 1 сутки (ТЗ, п. 3.2). */
export function defaultDates(today: string): { from: string; to: string } {
  return { from: today, to: addDaysStr(today, 1) };
}

export function parseResultParams(sp: RawParams, today: string, geo: CityGeo): ResultParams {
  const rawFrom = one(sp.from);
  const lastStart = addDaysStr(today, DATE_HORIZON_DAYS);
  const datesGiven = validDate(rawFrom) && rawFrom >= today && rawFrom <= lastStart;
  let from = datesGiven ? rawFrom : defaultDates(today).from;
  let to = one(sp.to);
  if (!datesGiven || !validDate(to) || to < from) to = addDaysStr(from, 1);
  if (rentalDays(from, to) > MAX_RENTAL_DAYS) to = addDaysStr(from, MAX_RENTAL_DAYS);

  const tab = one(sp.tab);
  return {
    classSlug: slug(sp.c),
    brandSlug: slug(sp.brand),
    from,
    to,
    days: rentalDays(from, to),
    datesGiven,
    loc: parseLocation({ loc: one(sp.loc), la: one(sp.la), src: one(sp.src) }, geo),
    tab: TAB_IDS.includes(tab as TabId) ? (tab as TabId) : null,
    filters: {
      noMoneyDeposit: flag(sp.nodep),
      claimed: flag(sp.claimed),
      oneDay: flag(sp.min1),
      openToday: flag(sp.open),
      models: slugList(sp.model),
      okrugs: slugList(sp.okrug, 10),
    },
  };
}

/** Query-строка для параметров (без «?»). Значения по умолчанию опускаются. */
export function resultQuery(p: ResultParams): string {
  const q = new URLSearchParams();
  if (p.classSlug) q.set("c", p.classSlug);
  if (p.brandSlug) q.set("brand", p.brandSlug);
  if (p.filters.models.length) q.set("model", p.filters.models.join(","));
  if (p.datesGiven) {
    q.set("from", p.from);
    q.set("to", p.to);
  }
  for (const [k, v] of Object.entries(locationQuery(p.loc))) q.set(k, v);
  if (p.tab) q.set("tab", p.tab);
  if (p.filters.noMoneyDeposit) q.set("nodep", "1");
  if (p.filters.claimed) q.set("claimed", "1");
  if (p.filters.oneDay) q.set("min1", "1");
  if (p.filters.openToday) q.set("open", "1");
  if (p.filters.okrugs.length) q.set("okrug", p.filters.okrugs.join(","));
  return q.toString();
}

export type ParamsPatch = Partial<Omit<ResultParams, "filters" | "days" | "datesGiven">> & {
  filters?: Partial<ResultFilters>;
};

export function patchParams(p: ResultParams, patch: ParamsPatch): ResultParams {
  const datesChanged = patch.from !== undefined || patch.to !== undefined;
  const from = patch.from ?? p.from;
  const to = patch.to ?? p.to;
  return {
    ...p,
    ...patch,
    from,
    to,
    days: rentalDays(from, to),
    datesGiven: p.datesGiven || datesChanged,
    filters: { ...p.filters, ...patch.filters },
  };
}

/** Параметры по умолчанию: город, без дат, без фильтров. */
export function emptyParams(today: string): ResultParams {
  const d = defaultDates(today);
  return {
    classSlug: null, brandSlug: null, ...d, days: 1, datesGiven: false,
    loc: CITY_LOCATION, tab: null, filters: NO_FILTERS,
  };
}

/** Ссылка на выдачу; у пути может уже быть запрос (`/krasnodar/poisk?q=…`). */
export function resultHref(path: string, p: ResultParams): string {
  const q = resultQuery(p);
  if (!q) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${q}`;
}

/** Страница группы: /{city}/{group}. */
export function groupPath(citySlug: string, groupSlug: string): string {
  return `/${citySlug}/${groupSlug}`;
}

/** Страница модели: /{city}/{prokat|arenda}-{model} — слово из seo_word группы. */
export function modelPath(citySlug: string, seoWord: string, modelSlug: string): string {
  return `/${citySlug}/${seoWord}-${modelSlug}`;
}

/** Адрес выдачи для цели поиска: одна модель — её страница, иначе страница группы с фильтрами. */
export function targetHref(citySlug: string, t: SearchTarget, seoWords: Record<string, string>, p: ResultParams): string {
  if (t.modelSlugs?.length === 1) {
    return resultHref(modelPath(citySlug, seoWords[t.groupSlug] ?? "prokat", t.modelSlugs[0]), p);
  }
  const scoped = patchParams(p, {
    classSlug: t.classSlug ?? null,
    brandSlug: t.brandSlug ?? null,
    filters: { models: t.modelSlugs ?? [] },
  });
  return resultHref(groupPath(citySlug, t.groupSlug), scoped);
}

/** Сколько фильтров включено — для кнопки «Фильтры · N». */
export function activeFilterCount(f: ResultFilters): number {
  return [f.noMoneyDeposit, f.claimed, f.oneDay, f.openToday].filter(Boolean).length + f.models.length + f.okrugs.length;
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
