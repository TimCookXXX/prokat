// Модель страницы сравнения: всё, что показывает выдача, из предложений класса
// и параметров из URL. Считает только через pricing.ts; чистые функции.

import { ruPlural } from "@/lib/plural";
import {
  TABS, formatRub as fmtRub, minTotal, rank, tabList, weekSavingsHint,
  type OfferInput, type Quote, type Rub, type SavingsHint, type Scenario, type TabId,
} from "@/lib/compare/pricing";
import type { CompareFilters, CompareParams } from "@/lib/compare/scenario";
import type { VerifiedBy } from "@/lib/compare/offers-csv";
import { modelMatches } from "@/lib/compare/search";

/** Предложение с полями для показа (телефон сюда не входит — он отдаётся по клику). */
export interface CompareOffer extends OfferInput {
  shopSlug: string;
  verifiedBy: VerifiedBy;
}

export interface TabSummary {
  id: TabId;
  label: string;
  /** Подпись на телефоне, где вкладки узкие. */
  shortLabel: string;
  winnerLabel: string;
  best: Quote | null;
  /** Кто лучший и чем: «Бур и Молот · залог паспорт». */
  note: string | null;
}

export interface FilterPrices {
  noMoneyDeposit: Rub | null;
  sameDay: Rub | null;
  claimed: Rub | null;
  oneDay: Rub | null;
  delivery: Rub | null;
  pickup: Rub | null;
  areas: { name: string; min: Rub | null }[];
}

export interface CompareView {
  scenario: Scenario;
  /** Выдача текущей вкладки с фильтрами, по возрастанию итога. */
  list: Quote[];
  tabs: TabSummary[];
  prices: FilterPrices;
  hint: SavingsHint | null;
  /** Цены старше 30 дней — вне рейтинга. */
  recheck: Quote[];
  /** Не возят, а нужна доставка — вне рейтинга. */
  pickupOnly: Quote[];
  summary: { shops: number; min: Rub | null; max: Rub | null };
  /** Вкладка «Без денежного залога»: сколько остальных просят залог и какой. */
  noDepNote: { others: number; minDeposit: Rub; maxDeposit: Rub } | null;
}

const SHORT_LABELS: Record<TabId, string> = {
  cheapest: "Дешевле всего",
  noMoneyDeposit: "Без залога",
  sameDay: "Сегодня",
};

type Predicate = (q: Quote) => boolean;

const FILTER_TESTS: Record<Exclude<keyof CompareFilters, "areas">, Predicate> = {
  noMoneyDeposit: (q) => q.offer.depositRub === 0,
  sameDay: (q) => q.offer.delivery.sameDay,
  claimed: (q) => q.offer.claimed,
  oneDay: (q) => q.offer.priceDay != null && q.offer.minDays <= 1,
};

/** Предикат включённых фильтров; `skip` — не учитывать один из них (для цены у самого фильтра). */
export function filterPredicate(f: CompareFilters, skip?: keyof CompareFilters): Predicate {
  const tests: Predicate[] = [];
  for (const key of Object.keys(FILTER_TESTS) as (keyof typeof FILTER_TESTS)[]) {
    if (f[key] && key !== skip) tests.push(FILTER_TESTS[key]);
  }
  if (f.areas.length && skip !== "areas") tests.push((q) => f.areas.includes(q.offer.district));
  return (q) => tests.every((t) => t(q));
}

function tabNote(id: TabId, q: Quote): string {
  if (id === "noMoneyDeposit" && q.offer.depositDocument) return `${q.offer.shopName} · залог паспорт`;
  if (id === "sameDay") return `${q.offer.shopName} · сегодня`;
  return q.offer.shopName;
}

export function buildCompareView(allOffers: CompareOffer[], p: CompareParams, today: string): CompareView {
  // Модель из поиска сужает всю выдачу, включая блоки вне рейтинга и цены у фильтров.
  const byModel = modelMatches(p.model);
  const offers = allOffers.filter((o) => byModel(o.model));
  const scenario: Scenario = { days: p.days, needDelivery: !p.pickup };
  const r = rank(offers, scenario, today);
  const byFilters = filterPredicate(p.filters);
  const ranked = r.ranked.filter(byFilters);

  const tabs: TabSummary[] = TABS.map((t) => {
    const best = tabList(r, t.id).find(byFilters) ?? null;
    return {
      id: t.id,
      label: t.label,
      shortLabel: SHORT_LABELS[t.id],
      winnerLabel: t.winnerLabel,
      best,
      note: best ? tabNote(t.id, best) : null,
    };
  });

  // Цена у фильтра — минимальный итог, если включить именно его поверх остальных.
  const priceWith = (key: keyof typeof FILTER_TESTS) => {
    const others = filterPredicate(p.filters, key);
    return minTotal(r.ranked, (q) => others(q) && FILTER_TESTS[key](q));
  };
  const delivery = p.pickup ? rank(offers, { ...scenario, needDelivery: true }, today) : r;
  const pickup = p.pickup ? r : rank(offers, { ...scenario, needDelivery: false }, today);
  const withoutAreas = filterPredicate(p.filters, "areas");
  const districts = [...new Set(offers.map((o) => o.district).filter(Boolean))];
  const areas = districts
    .map((name) => ({ name, min: minTotal(r.ranked, (q) => withoutAreas(q) && q.offer.district === name) }))
    .sort((a, b) => (a.min ?? Infinity) - (b.min ?? Infinity) || a.name.localeCompare(b.name, "ru"));

  const list = tabList(r, p.tab).filter(byFilters);

  let noDepNote: CompareView["noDepNote"] = null;
  if (p.tab === "noMoneyDeposit") {
    const deposits = ranked.filter((q) => (q.offer.depositRub ?? 0) > 0).map((q) => q.offer.depositRub!);
    if (deposits.length) {
      noDepNote = { others: deposits.length, minDeposit: Math.min(...deposits), maxDeposit: Math.max(...deposits) };
    }
  }

  const totals = ranked.map((q) => q.total);
  return {
    scenario,
    list,
    tabs,
    prices: {
      noMoneyDeposit: priceWith("noMoneyDeposit"),
      sameDay: priceWith("sameDay"),
      claimed: priceWith("claimed"),
      oneDay: priceWith("oneDay"),
      delivery: minTotal(delivery.ranked, byFilters),
      pickup: minTotal(pickup.ranked, byFilters),
      areas,
    },
    hint: weekSavingsHint(r, scenario),
    recheck: r.recheck,
    pickupOnly: r.pickupOnly,
    summary: {
      shops: new Set(offers.map((o) => o.shopId)).size,
      min: totals.length ? Math.min(...totals) : null,
      max: totals.length ? Math.max(...totals) : null,
    },
    noDepNote,
  };
}

// ------------------------------------------------------------- тексты билета

const days = (n: number) => `${n} ${ruPlural(n, "сутки", "суток", "суток")}`;

/** Расшифровка итога под суммой: «900 ₽ аренда + 400 ₽ доставка». */
export function quoteBreakdown(q: Quote, needDelivery: boolean): string {
  const rentPart = q.minApplied
    ? `${fmtRub(q.rent)} за ${days(q.billedDays)} (${q.offer.priceDay == null ? "понедельно" : "минимум"})`
    : `${fmtRub(q.rent)} аренда`;
  if (!needDelivery) return `${rentPart}, самовывоз`;
  if (q.deliveryFee === 0) return `${rentPart}, доставка бесплатно`;
  return `${rentPart} + ${fmtRub(q.deliveryFee)}${q.minApplied ? "" : " доставка"}`;
}

export type DepositTone = "normal" | "warn";

/** Чип залога: «Залог: 3 000 ₽», «Залог: паспорт», «Без залога», «Залог уточняется». */
export function depositLabel(o: OfferInput): { text: string; tone: DepositTone } {
  if (o.depositRub === null) return { text: "Залог уточняется", tone: "warn" };
  if (o.depositRub > 0) return { text: `Залог: ${fmtRub(o.depositRub)}${o.depositDocument ? " + паспорт" : ""}`, tone: "normal" };
  return { text: o.depositDocument ? "Залог: паспорт" : "Без залога", tone: "normal" };
}

/** Чип минимального срока: «от 3 суток» (предупреждение, если больше 1). */
export function minTermLabel(o: OfferInput): { text: string; tone: DepositTone } {
  if (o.priceDay == null) return { text: "понедельно", tone: "warn" };
  return { text: `от ${o.minDays} суток`, tone: o.minDays > 1 ? "warn" : "normal" };
}

/** Чип недельного тарифа. */
export function weekLabel(o: OfferInput): string {
  return o.priceWeek ? `${fmtRub(o.priceWeek)} за неделю` : "без недельного тарифа";
}

// -------------------------------------------------- место в сравнении

export type Place =
  | { kind: "ranked"; place: number; of: number; /** Сколько не хватает до 1-го места. */ gapToFirst: Rub }
  | { kind: "recheck" }
  | { kind: "pickupOnly" };

/** Место предложения среди предложений класса при сценарии (для страницы и кабинета проката). */
export function placeInComparison(classOffers: OfferInput[], offerId: string, s: Scenario, today: string): Place | null {
  const r = rank(classOffers, s, today);
  const i = r.ranked.findIndex((q) => q.offer.id === offerId);
  if (i >= 0) return { kind: "ranked", place: i + 1, of: r.ranked.length, gapToFirst: r.ranked[i].total - r.ranked[0].total };
  if (r.recheck.some((q) => q.offer.id === offerId)) return { kind: "recheck" };
  if (r.pickupOnly.some((q) => q.offer.id === offerId)) return { kind: "pickupOnly" };
  return null;
}

export function placeLabel(p: Place | null): string {
  if (!p) return "—";
  if (p.kind === "recheck") return "на перепроверке";
  if (p.kind === "pickupOnly") return "только самовывоз";
  return `${p.place}-е из ${p.of}`;
}

// ------------------------------------------------- сводки проката

/** Сводка залогов проката: «паспорт или деньги», «без залога», «уточняется». */
export function depositSummary(offers: OfferInput[]): string {
  const kinds = new Set<string>(offers.map((o) =>
    o.depositRub === null ? "уточняется" : o.depositRub > 0 ? "деньги" : o.depositDocument ? "паспорт" : "без залога"));
  const order = ["без залога", "паспорт", "деньги", "уточняется"];
  return order.filter((k) => kinds.has(k)).join(" или ") || "—";
}

export function deliverySummary(offers: OfferInput[]): string {
  const withDelivery = offers.filter((o) => o.delivery.available);
  if (!withDelivery.length) return "только самовывоз";
  const min = Math.min(...withDelivery.map((o) => o.delivery.price));
  return min === 0 ? "бесплатно по городу" : `от ${fmtRub(min)} по городу`;
}
