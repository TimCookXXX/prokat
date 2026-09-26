import { describe, it, expect } from "vitest";
import { buildCompareView, deliverySummary, depositLabel, depositSummary, filterPredicate, minTermLabel, placeInComparison, placeLabel, quoteBreakdown, type CompareOffer } from "@/lib/compare/view";
import { parseCompareParams, patchParams } from "@/lib/compare/scenario";
import { quote } from "@/lib/compare/pricing";

// Набор макетов: те же 8 прокатов, что в pricing.test.ts.
const base = { itemClassId: "cls", claimed: false, depositDocument: false, verifiedBy: "call" as const };
const O = (o: Omit<CompareOffer, "itemClassId" | "claimed" | "depositDocument" | "verifiedBy" | "shopSlug"> & Partial<CompareOffer>): CompareOffer =>
  ({ ...base, shopSlug: o.shopId, ...o });
const OFFERS: CompareOffer[] = [
  O({ id: "a", shopId: "s-a", shopName: "Инструмент у дома", district: "ЮМР", priceDay: 450, priceWeek: 2400, minDays: 1, depositRub: 3000, delivery: { available: true, price: 400, freeFrom: 2000, sameDay: false }, verifiedAt: "2026-09-18", claimed: true }),
  O({ id: "b", shopId: "s-b", shopName: "Бур и Молот", district: "ФМР", priceDay: 500, minDays: 1, depositRub: 0, depositDocument: true, delivery: { available: true, price: 350, sameDay: false }, verifiedAt: "2026-09-15" }),
  O({ id: "c", shopId: "s-c", shopName: "РемПрокат-23", district: "Гидрострой", priceDay: 350, minDays: 2, depositRub: 2000, delivery: { available: false, price: 0, sameDay: false }, verifiedAt: "2026-09-20" }),
  O({ id: "d", shopId: "s-d", shopName: "Склад на Уральской", district: "Энка", priceDay: 600, priceWeek: 3000, minDays: 1, depositRub: 5000, delivery: { available: true, price: 500, freeFrom: 3000, sameDay: false }, verifiedAt: "2026-09-12", claimed: true }),
  O({ id: "e", shopId: "s-e", shopName: "Мастерская Фёдорова", district: "ЧМР", priceDay: 400, minDays: 1, depositRub: 2000, depositDocument: true, delivery: { available: true, price: 300, sameDay: false }, verifiedAt: "2026-08-02" }),
  O({ id: "f", shopId: "s-f", shopName: "Точка инструмента", district: "Центр", priceDay: 900, minDays: 1, depositRub: 10000, delivery: { available: true, price: 0, sameDay: true }, verifiedAt: "2026-09-19" }),
  O({ id: "g", shopId: "s-g", shopName: "Дрель и Ко", district: "Музыкальный", priceDay: 550, priceWeek: 2800, minDays: 1, depositRub: 3000, delivery: { available: true, price: 450, sameDay: true }, verifiedAt: "2026-09-17" }),
  O({ id: "h", shopId: "s-h", shopName: "Прокат «Кран-Балка»", district: "Фестивальный", priceDay: 380, minDays: 3, depositRub: 1500, delivery: { available: true, price: 350, sameDay: false }, verifiedAt: "2026-09-16" }),
];
const TODAY = "2026-09-23";
const P = parseCompareParams({ from: "2026-09-26", to: "2026-09-28" }, TODAY);

describe("buildCompareView — модель из поиска", () => {
  const withModels = OFFERS.map((o, i) => ({ ...o, model: ["Makita HR2470", "Makita HR2630", "Bosch GBH 2-26"][i % 3] }));

  it("keeps only offers of the chosen model or brand, everywhere", () => {
    const brand = buildCompareView(withModels, patchParams(P, { model: "makita" }), TODAY);
    const all = [...brand.list, ...brand.recheck, ...brand.pickupOnly].map((q) => q.offer.model);
    expect(new Set(all)).toEqual(new Set(["Makita HR2470", "Makita HR2630"]));
    const one = buildCompareView(withModels, patchParams(P, { model: "Bosch GBH 2-26" }), TODAY);
    expect(one.summary.shops).toBe(2);
    expect(one.list.every((q) => q.offer.model === "Bosch GBH 2-26")).toBe(true);
  });
});

describe("buildCompareView — выдача макета CompareB", () => {
  const v = buildCompareView(OFFERS, P, TODAY);

  it("ranks the cheapest tab and fills the tab headers", () => {
    expect(v.list.map((q) => [q.offer.id, q.total])).toEqual([
      ["a", 1300], ["b", 1350], ["h", 1490], ["g", 1550], ["d", 1700], ["f", 1800],
    ]);
    expect(v.tabs.map((t) => [t.id, t.best?.total, t.note])).toEqual([
      ["cheapest", 1300, "Инструмент у дома"],
      ["noMoneyDeposit", 1350, "Бур и Молот · залог паспорт"],
      ["sameDay", 1550, "Дрель и Ко · сегодня"],
    ]);
  });

  it("prices every filter like the sidebar of the mockup", () => {
    expect(v.prices).toMatchObject({
      noMoneyDeposit: 1350, delivery: 1300, sameDay: 1550, pickup: 700, claimed: 1300, oneDay: 1300,
    });
    expect(v.prices.areas.slice(0, 3)).toEqual([
      { name: "ЮМР", min: 1300 }, { name: "ФМР", min: 1350 }, { name: "Фестивальный", min: 1490 },
    ]);
  });

  it("keeps stale and pickup-only offers out of the ranking", () => {
    expect(v.recheck.map((q) => q.offer.id)).toEqual(["e"]);
    expect(v.pickupOnly.map((q) => [q.offer.id, q.total])).toEqual([["c", 700]]);
    expect(v.summary).toEqual({ shops: 8, min: 1300, max: 1800 });
    expect(v.hint?.offer.id).toBe("a");
  });

  it("applies sidebar filters on top of the tab", () => {
    const f = buildCompareView(OFFERS, patchParams(P, { filters: { areas: ["ФМР", "Центр"] } }), TODAY);
    expect(f.list.map((q) => q.offer.id)).toEqual(["b", "f"]);
    const claimed = buildCompareView(OFFERS, patchParams(P, { tab: "sameDay", filters: { claimed: true } }), TODAY);
    expect(claimed.list).toEqual([]);
  });

  it("counts the others with a money deposit on the no-deposit tab", () => {
    const nd = buildCompareView(OFFERS, patchParams(P, { tab: "noMoneyDeposit" }), TODAY);
    expect(nd.list.map((q) => q.offer.id)).toEqual(["b"]);
    expect(nd.noDepNote).toEqual({ others: 5, minDeposit: 1500, maxDeposit: 10000 });
  });

  it("ranks pickup totals when picking up", () => {
    const pk = buildCompareView(OFFERS, patchParams(P, { pickup: true }), TODAY);
    expect(pk.list[0].offer.id).toBe("c");
    expect(pk.pickupOnly).toEqual([]);
    expect(pk.prices.delivery).toBe(1300);
  });
});

describe("ticket texts", () => {
  const q = (id: string, days = 2, needDelivery = true) => quote(OFFERS.find((o) => o.id === id)!, { days, needDelivery })!;

  it("breaks the total down", () => {
    expect(quoteBreakdown(q("a"), true)).toBe("900 ₽ аренда + 400 ₽ доставка");
    expect(quoteBreakdown(q("h"), true)).toBe("1 140 ₽ за 3 суток (минимум) + 350 ₽");
    expect(quoteBreakdown(q("f"), true)).toBe("1 800 ₽ аренда, доставка бесплатно");
    expect(quoteBreakdown(q("c", 2, false), false)).toBe("700 ₽ аренда, самовывоз");
  });

  it("labels deposit and minimum term", () => {
    const by = (id: string) => OFFERS.find((o) => o.id === id)!;
    expect(depositLabel(by("b"))).toEqual({ text: "Залог: паспорт", tone: "normal" });
    expect(depositLabel({ ...by("b"), depositDocument: false })).toEqual({ text: "Без залога", tone: "normal" });
    expect(depositLabel({ ...by("a"), depositRub: null })).toEqual({ text: "Залог уточняется", tone: "warn" });
    expect(minTermLabel(by("h"))).toEqual({ text: "от 3 суток", tone: "warn" });
    expect(minTermLabel({ ...by("a"), priceDay: null, priceWeek: 3900 })).toEqual({ text: "понедельно", tone: "warn" });
  });

  it("builds filter predicates that can skip one filter", () => {
    const f = { noMoneyDeposit: true, sameDay: false, claimed: true, oneDay: false, areas: [] };
    expect(filterPredicate(f)(q("b"))).toBe(false);          // не подтвердил цены
    expect(filterPredicate(f, "claimed")(q("b"))).toBe(true);
  });
});

describe("placeInComparison", () => {
  const s = { days: 2, needDelivery: true };
  it("reports the place and the gap to the leader", () => {
    expect(placeInComparison(OFFERS, "h", s, TODAY)).toEqual({ kind: "ranked", place: 3, of: 6, gapToFirst: 190 });
    expect(placeLabel(placeInComparison(OFFERS, "a", s, TODAY))).toBe("1-е из 6");
  });
  it("names why an offer is out of the ranking", () => {
    expect(placeLabel(placeInComparison(OFFERS, "e", s, TODAY))).toBe("на перепроверке");
    expect(placeLabel(placeInComparison(OFFERS, "c", s, TODAY))).toBe("только самовывоз");
    expect(placeInComparison(OFFERS, "zzz", s, TODAY)).toBeNull();
  });
});

describe("shop summaries", () => {
  it("summarises deposits and delivery", () => {
    const by = (id: string) => OFFERS.find((o) => o.id === id)!;
    expect(depositSummary([by("a"), by("b")])).toBe("паспорт или деньги");
    expect(depositSummary([{ ...by("a"), depositRub: null }])).toBe("уточняется");
    expect(deliverySummary([by("a"), by("b")])).toBe("от 350 ₽ по городу");
    expect(deliverySummary([by("f")])).toBe("бесплатно по городу");
    expect(deliverySummary([by("c")])).toBe("только самовывоз");
  });
});
