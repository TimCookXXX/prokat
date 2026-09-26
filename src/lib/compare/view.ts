// Модель страницы выдачи (ТЗ, раздел 5): всё, что показывает выдача, из предложений
// и параметров из URL. Итог — только через pricing.ts, порядок — через ranking.ts.
// Чистые функции.

import { ruPlural } from "@/lib/plural";
import {
  formatRub as fmtRub, priceAll, weekSavingsHint,
  type OfferInput, type Quote, type Rub, type SavingsHint,
} from "@/lib/compare/pricing";
import {
  TAB_LABELS, defaultTab, explainFirst, place, sortForTab, tabsFor, type Placed, type TabId,
} from "@/lib/compare/ranking";
import { pointKey, shopPoint, userOkrug, userPoint, type CityGeo, type GeoPoint, type RoadRoute, type UserLocation } from "@/lib/compare/geo";
import { openState, type WeekHours } from "@/lib/compare/hours";
import type { ResultFilters, ResultParams } from "@/lib/compare/scenario";
import type { VerifiedBy } from "@/lib/compare/offers-csv";

/** Предложение с полями для показа (телефон сюда не входит — он отдаётся по клику). */
export interface CompareOffer extends OfferInput {
  shopSlug: string;
  verifiedBy: VerifiedBy;
  /** Модель из справочника; null — не указана или не распознана. */
  modelId?: string | null;
  modelSlug?: string | null;
  /** «Makita HR2470» — каноническое название из справочника. */
  modelName?: string | null;
  brandSlug?: string | null;
  /** Что входит в аренду. */
  includes?: string | null;
  /** Где прокат: микрорайон и округ (slug), координаты адреса, адрес. */
  place?: {
    microdistrict: string | null;
    okrug: string | null;
    lat: number | null;
    lon: number | null;
    address: string | null;
  };
  hours?: WeekHours | null;
}

export interface TabSummary {
  id: TabId;
  label: string;
  /** Подпись на телефоне, где вкладки узкие. */
  shortLabel: string;
  winnerLabel: string;
  best: Placed | null;
}

export interface FilterPrices {
  noMoneyDeposit: Rub | null;
  claimed: Rub | null;
  oneDay: Rub | null;
  openToday: Rub | null;
  /** Модели в выдаче: число предложений и минимальный итог. */
  models: { slug: string; name: string; count: number; min: Rub | null }[];
  okrugs: { slug: string; name: string; min: Rub | null }[];
}

export interface ResultSection {
  title: string | null;
  items: Placed[];
}

export interface ResultView {
  days: number;
  datesGiven: boolean;
  locKind: UserLocation["kind"];
  userOkrug: string | null;
  tabs: TabSummary[];
  tab: TabId;
  /** Выдача вкладки с фильтрами. При округе — «В вашем округе» и «В других округах». */
  sections: ResultSection[];
  /** Чем первое предложение лучше альтернатив. */
  explanation: string | null;
  prices: FilterPrices;
  hint: SavingsHint | null;
  /** Цены старше 30 дней — вне рейтинга. */
  recheck: Placed[];
  summary: { shops: number; min: Rub | null; max: Rub | null };
}

export interface ViewContext {
  today: string;
  /** Местное время города: день недели (пн = 0) и «ЧЧ:ММ» — для «Работает сегодня». */
  now: { weekday: number; time: string };
  geo: CityGeo;
  /** Пути по дорогам до точек проката: pointKey → км и время (src/server/routing.ts). */
  roads?: Map<string, RoadRoute>;
}

type Predicate = (q: Placed) => boolean;
type FlagKey = "noMoneyDeposit" | "claimed" | "oneDay" | "openToday";

function flagTests(now: ViewContext["now"]): Record<FlagKey, Predicate> {
  return {
    noMoneyDeposit: (q) => q.offer.depositRub === 0,
    claimed: (q) => q.offer.claimed,
    oneDay: (q) => q.offer.priceDay != null && q.offer.minDays <= 1,
    openToday: (q) => openState((q.offer as CompareOffer).hours ?? null, now)?.openToday === true,
  };
}

const modelOf = (q: Placed) => (q.offer as CompareOffer).modelSlug ?? null;

/** Предикат включённых фильтров; `skip` — не учитывать один из них (для цены у самого фильтра). */
export function filterPredicate(f: ResultFilters, now: ViewContext["now"], skip?: keyof ResultFilters): Predicate {
  const flags = flagTests(now);
  const tests: Predicate[] = [];
  for (const key of Object.keys(flags) as FlagKey[]) if (f[key] && key !== skip) tests.push(flags[key]);
  if (f.models.length && skip !== "models") tests.push((q) => f.models.includes(modelOf(q) ?? ""));
  if (f.okrugs.length && skip !== "okrugs") tests.push((q) => f.okrugs.includes(q.okrug ?? ""));
  return (q) => tests.every((t) => t(q));
}

export function buildResultView(offers: CompareOffer[], p: ResultParams, ctx: ViewContext): ResultView {
  const { geo, today, now } = ctx;
  const priced = priceAll(offers, p.days, today);
  const placeCtx = {
    user: userPoint(p.loc, geo),
    shopPoint: (o: OfferInput) => {
      const pl = (o as CompareOffer).place;
      return pl ? shopPoint({ lat: pl.lat, lon: pl.lon, microdistrict: pl.microdistrict }, geo) : null;
    },
    shopOkrug: (o: OfferInput) => (o as CompareOffer).place?.okrug ?? null,
    today,
    road: (pt: GeoPoint) => ctx.roads?.get(pointKey(pt)) ?? null,
  };
  const all = place(priced.fresh, placeCtx);
  const recheck = place(priced.recheck, placeCtx);
  const okrug = userOkrug(p.loc, geo);

  const byFilters = filterPredicate(p.filters, now);
  const filtered = all.filter(byFilters);

  // Порядок, в котором человек видит карточки: при округе — сначала свой округ,
  // внутри — по вкладке. Из него же — лучший на вкладке, пояснение и цены у фильтров.
  const ordered = (list: Placed[], id: TabId): Placed[] => {
    const sorted = sortForTab(list, id, okrug);
    return p.loc.kind === "okrug"
      ? [...sorted.filter((q) => q.okrug === okrug), ...sorted.filter((q) => q.okrug !== okrug)]
      : sorted;
  };

  const available = tabsFor(p.loc.kind);
  const tab = p.tab && available.includes(p.tab) ? p.tab : defaultTab(filtered, available);
  // Без расстояний «Оптимальный» совпадает с «Самым дешёвым» — и подписан так же.
  const withTrips = filtered.some((q) => q.trip !== null);
  // Подпись первой карточки: при округе первой стоит лучшая в своём округе — не
  // «самая дешёвая за ваши даты», если в другом округе есть дешевле.
  const winnerFor = (id: TabId, first: Placed | undefined) => {
    if (p.loc.kind === "okrug" && first?.okrug === okrug) return TAB_LABELS.okrug.winner;
    if (id === "optimal" && !withTrips) return TAB_LABELS.cheapest.winner;
    return TAB_LABELS[id].winner;
  };
  const tabs: TabSummary[] = available.map((id) => {
    const best = ordered(filtered, id)[0] ?? null;
    return {
      id,
      label: TAB_LABELS[id].label,
      shortLabel: TAB_LABELS[id].short,
      winnerLabel: winnerFor(id, best ?? undefined),
      best,
    };
  });

  const sorted = ordered(filtered, tab);
  // Округ: список делится на свой и остальные, внутри — по выбранной вкладке.
  const sections: ResultSection[] = p.loc.kind === "okrug"
    ? [
      { title: "В вашем округе", items: sorted.filter((q) => q.okrug === okrug) },
      { title: "В других округах", items: sorted.filter((q) => q.okrug !== okrug) },
    ].filter((s) => s.items.length > 0)
    : [{ title: null, items: sorted }];

  // Цена у фильтра — итог первой карточки, если включить именно его поверх остальных
  // (ТЗ, критерий 21). На «Самом дешёвом» это и минимальный итог (п. 5.6).
  const lead = (list: Placed[]): Rub | null => ordered(list, tab)[0]?.total ?? null;
  const flags = flagTests(now);
  const priceWith = (key: FlagKey) => {
    const others = filterPredicate(p.filters, now, key);
    return lead(all.filter((q) => others(q) && flags[key](q)));
  };
  const withoutModels = filterPredicate(p.filters, now, "models");
  const modelNames = new Map<string, string>();
  for (const q of all) {
    const o = q.offer as CompareOffer;
    if (o.modelSlug && o.modelName) modelNames.set(o.modelSlug, o.modelName);
  }
  const models = [...modelNames]
    .map(([slug, name]) => {
      const list = all.filter((q) => withoutModels(q) && modelOf(q) === slug);
      return { slug, name, count: list.length, min: lead(list) };
    })
    .sort((a, b) => (a.min ?? Infinity) - (b.min ?? Infinity) || a.name.localeCompare(b.name, "ru"));
  const withoutOkrugs = filterPredicate(p.filters, now, "okrugs");
  const okrugs = geo.okrugs.map((o) => ({
    slug: o.slug, name: o.name, min: lead(all.filter((q) => withoutOkrugs(q) && q.okrug === o.slug)),
  }));

  const totals = filtered.map((q) => q.total);
  return {
    days: p.days,
    datesGiven: p.datesGiven,
    locKind: p.loc.kind,
    userOkrug: okrug,
    tabs,
    tab,
    sections,
    explanation: explainFirst(sorted, p.loc.kind === "okrug" ? "okrug" : tab, okrug),
    prices: {
      noMoneyDeposit: priceWith("noMoneyDeposit"),
      claimed: priceWith("claimed"),
      oneDay: priceWith("oneDay"),
      openToday: priceWith("openToday"),
      models,
      okrugs,
    },
    hint: weekSavingsHint(filtered, p.days),
    recheck,
    summary: {
      shops: new Set(filtered.map((q) => q.offer.shopId)).size,
      min: totals.length ? Math.min(...totals) : null,
      max: totals.length ? Math.max(...totals) : null,
    },
  };
}

// ------------------------------------------------------------- тексты карточки

export const daysText = (n: number) => `${n} ${ruPlural(n, "сутки", "суток", "суток")}`;

/** Расшифровка итога: «за 2 суток», «за 3 суток — минимальный срок проката». */
export function quoteBreakdown(q: Quote): string {
  if (!q.minApplied) return `за ${daysText(q.billedDays)}`;
  return q.offer.priceDay == null
    ? `за ${daysText(q.billedDays)} — сдаёт понедельно`
    : `за ${daysText(q.billedDays)} — минимальный срок проката`;
}

export type DepositTone = "normal" | "warn";

/** Залог: «3 000 ₽», «без денежного залога — паспорт», «уточняется». */
export function depositLabel(o: OfferInput): { text: string; tone: DepositTone } {
  if (o.depositRub === null) return { text: "Залог уточняется", tone: "warn" };
  if (o.depositRub > 0) return { text: `Залог ${fmtRub(o.depositRub)}${o.depositDocument ? " + паспорт" : ""}`, tone: "normal" };
  return { text: o.depositDocument ? "Без денежного залога — паспорт" : "Без залога", tone: "normal" };
}

/** Минимальный срок: «от 3 суток» (предупреждение, если больше 1). */
export function minTermLabel(o: OfferInput): { text: string; tone: DepositTone } {
  if (o.priceDay == null) return { text: "понедельно", tone: "warn" };
  return { text: `от ${o.minDays} суток`, tone: o.minDays > 1 ? "warn" : "normal" };
}

/** Недельный тариф. */
export function weekLabel(o: OfferInput): string | null {
  return o.priceWeek ? `${fmtRub(o.priceWeek)} за неделю` : null;
}

// -------------------------------------------------- место в сравнении

export type Place =
  | { kind: "ranked"; place: number; of: number; /** Сколько не хватает до 1-го места. */ gapToFirst: Rub }
  | { kind: "recheck" };

/** Место предложения среди предложений класса по итогу за `days` суток (страница и кабинет проката). */
export function placeInComparison(classOffers: OfferInput[], offerId: string, days: number, today: string): Place | null {
  const r = priceAll(classOffers, days, today);
  const i = r.fresh.findIndex((q) => q.offer.id === offerId);
  if (i >= 0) return { kind: "ranked", place: i + 1, of: r.fresh.length, gapToFirst: r.fresh[i].total - r.fresh[0].total };
  if (r.recheck.some((q) => q.offer.id === offerId)) return { kind: "recheck" };
  return null;
}

export function placeLabel(p: Place | null): string {
  if (!p) return "—";
  if (p.kind === "recheck") return "на перепроверке";
  return `${p.place}-е из ${p.of}`;
}

// ------------------------------------------------- сводки проката

/** Сводка залогов: «паспорт или деньги», «без залога», «уточняется». */
export function depositSummary(offers: OfferInput[]): string {
  const kinds = new Set<string>(offers.map((o) =>
    o.depositRub === null ? "уточняется" : o.depositRub > 0 ? "деньги" : o.depositDocument ? "паспорт" : "без залога"));
  const order = ["без залога", "паспорт", "деньги", "уточняется"];
  return order.filter((k) => kinds.has(k)).join(" или ") || "—";
}

/** Сколько прокатов из списка доставляют — справочно, в итог доставка не входит. */
export function deliverySummary(offers: OfferInput[]): string {
  const n = new Set(offers.filter((o) => o.delivery.available).map((o) => o.shopId)).size;
  return n ? `доставляют ${n} ${ruPlural(n, "прокат", "проката", "прокатов")} — условия уточняйте` : "только самовывоз";
}
