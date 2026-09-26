import { describe, expect, it } from "vitest";
import { buildResultView, depositLabel, quoteBreakdown, type CompareOffer } from "@/lib/compare/view";
import { dominates, sortForTab, type Placed } from "@/lib/compare/ranking";
import { emptyParams, patchParams, type ResultParams } from "@/lib/compare/scenario";
import { quote } from "@/lib/compare/pricing";
import { CITY_GEO } from "@/lib/compare/geo-data";
import type { UserLocation } from "@/lib/compare/geo";

const geo = CITY_GEO[0];
const TODAY = "2026-09-23";
const ctx = { today: TODAY, now: { weekday: 2, time: "12:00" }, geo };

type Opt = Partial<CompareOffer> & Pick<CompareOffer, "id" | "priceDay">;
const O = (o: Opt): CompareOffer => ({
  shopId: `s-${o.id}`, shopSlug: `s-${o.id}`, shopName: `Прокат ${o.id}`, itemClassId: "cls", district: "",
  minDays: 1, depositRub: 2000, depositDocument: false, claimed: false, verifiedBy: "call", verifiedAt: "2026-09-20",
  delivery: { available: false, price: 0, sameDay: false },
  place: { microdistrict: null, okrug: null, lat: null, lon: null, address: null },
  ...o,
});
const at = (slug: string) => {
  const m = geo.microdistricts.find((x) => x.slug === slug)!;
  return { microdistrict: slug, okrug: m.okrug, lat: m.lat, lon: m.lon, address: "адрес" };
};
const inMd = (slug: string) => ({ ...at(slug), lat: null, lon: null, address: null });

// Пользователь в ЮМР. «near» — рядом и дороже, «far» — далеко и дешевле,
// «worse» — дороже и дальше «near», «nowhere» — без местоположения, «old» — старая цена.
const OFFERS: CompareOffer[] = [
  O({ id: "near", priceDay: 1000, place: at("tsentr") }),
  O({ id: "far", priceDay: 900, place: at("vitaminkombinat") }),
  O({ id: "worse", priceDay: 1050, place: at("komsomolskiy"), delivery: { available: true, price: 0, sameDay: true } }),
  O({ id: "nowhere", priceDay: 950 }),
  O({ id: "old", priceDay: 100, place: at("yubileynyy"), verifiedAt: "2026-08-14" }),
];
const withLoc = (loc: UserLocation, patch: Partial<ResultParams> = {}) => ({ ...emptyParams(TODAY), loc, ...patch });
const ymr: UserLocation = { kind: "microdistrict", microdistrict: "yubileynyy" };
const ids = (v: ReturnType<typeof buildResultView>) => v.sections.flatMap((s) => s.items.map((q) => q.offer.id));

describe("acceptance: results", () => {
  it("7. без дат — итог за 1 сутки с пометкой", () => {
    const v = buildResultView(OFFERS, emptyParams(TODAY), ctx);
    expect(v.days).toBe(1);
    expect(v.datesGiven).toBe(false);
  });

  it("11. город: нет «Ближе всего», «Оптимальный» совпадает с «Самым дешёвым»", () => {
    const opt = buildResultView(OFFERS, withLoc({ kind: "city" }, { tab: "optimal" }), ctx);
    const cheap = buildResultView(OFFERS, withLoc({ kind: "city" }, { tab: "cheapest" }), ctx);
    expect(opt.tabs.map((t) => t.id)).toEqual(["optimal", "cheapest"]);
    expect(ids(opt)).toEqual(ids(cheap));
    expect(opt.sections[0].items.every((q) => q.trip === null)).toBe(true);
  });

  it("12. округ: «В вашем округе» / «В других округах», без километров", () => {
    const v = buildResultView(OFFERS, withLoc({ kind: "okrug", okrug: "zapadnyy" }), ctx);
    expect(v.sections.map((s) => s.title)).toEqual(["В вашем округе", "В других округах"]);
    expect(v.sections[0].items.map((q) => q.offer.id)).toEqual(["near"]);
    expect(v.tabs.map((t) => t.id)).toEqual(["optimal", "cheapest", "okrug"]);
    expect(v.sections.flatMap((s) => s.items).every((q) => q.trip === null)).toBe(true);
  });

  it("15. цена 40-дневной давности — только в блоке «на перепроверке»", () => {
    const v = buildResultView(OFFERS, withLoc(ymr), ctx);
    expect(ids(v)).not.toContain("old");
    expect(v.recheck.map((q) => q.offer.id)).toEqual(["old"]);
  });

  it("16. дороже и дальше другого — не первым ни в одной вкладке", () => {
    for (const tab of ["optimal", "cheapest", "nearest"] as const) {
      const v = buildResultView(OFFERS, withLoc(ymr, { tab }), ctx);
      const [first, ...rest] = v.sections[0].items;
      expect(rest.some((q) => dominates(q, first)), tab).toBe(false);
    }
  });

  it("17. без местоположения не выше прокатов с местоположением в «Оптимальном» и «Ближе всего»", () => {
    for (const tab of ["optimal", "nearest"] as const) {
      const list = ids(buildResultView(OFFERS, withLoc(ymr, { tab }), ctx));
      expect(list.at(-1), tab).toBe("nowhere");
    }
  });

  it("18. разброс итогов < 15% при известном местоположении — по умолчанию «Ближе всего»", () => {
    const close = OFFERS.filter((o) => ["near", "worse", "far"].includes(o.id)); // 900…1050: 16,7%
    expect(buildResultView(close, withLoc(ymr), ctx).tab).toBe("optimal");
    const tight = close.filter((o) => o.id !== "far"); // 1000…1050: 5%
    expect(buildResultView(tight, withLoc(ymr), ctx).tab).toBe("nearest");
    expect(buildResultView(tight, withLoc({ kind: "city" }), ctx).tab).toBe("optimal");
  });

  it("19. доставка не меняет порядок", () => {
    const noDelivery = OFFERS.map((o) => ({ ...o, delivery: { available: false, price: 0, sameDay: false } }));
    for (const tab of ["optimal", "cheapest", "nearest"] as const) {
      expect(ids(buildResultView(OFFERS, withLoc(ymr, { tab }), ctx)))
        .toEqual(ids(buildResultView(noDelivery, withLoc(ymr, { tab }), ctx)));
    }
  });

  it("21. цена у фильтра совпадает с первым итогом после его применения", () => {
    const offers = [...OFFERS, O({ id: "nodep", priceDay: 1200, depositRub: 0, place: at("festivalnyy") })];
    const p = withLoc(ymr, { tab: "cheapest" });
    const v = buildResultView(offers, p, ctx);
    const after = buildResultView(offers, patchParams(p, { filters: { noMoneyDeposit: true } }), ctx);
    expect(v.prices.noMoneyDeposit).toBe(after.sections[0].items[0].total);
  });
});

describe("tabs and explanation", () => {
  it("«Оптимальный» учитывает дорогу: рядом дороже на 100 ₽, но в разы ближе", () => {
    const v = buildResultView(OFFERS, withLoc(ymr, { tab: "optimal" }), ctx);
    expect(ids(v)[0]).toBe("near");
    expect(v.explanation).toMatch(/^На 100\s₽ дороже самого дешёвого, но в \d+(,5)? раза? ближе$/);
  });

  it("«Самый дешёвый» — со временем в пути", () => {
    const v = buildResultView(OFFERS, withLoc(ymr, { tab: "cheapest" }), ctx);
    expect(ids(v)[0]).toBe("far");
    expect(v.explanation).toMatch(/^Самый дешёвый, ≈ \d+ мин в одну сторону$/);
  });

  it("каждая вкладка знает своего лучшего", () => {
    const v = buildResultView(OFFERS, withLoc(ymr), ctx);
    expect(Object.fromEntries(v.tabs.map((t) => [t.id, t.best?.offer.id]))).toEqual({ optimal: "near", cheapest: "far", nearest: "near" });
  });

  it("sortForTab: недоминируемое выходит вперёд", () => {
    const mk = (id: string, total: number, km: number | null): Placed => ({
      ...quote(O({ id, priceDay: total }), 1), trip: km === null ? null : { km, minutes: km * 2, approx: false },
      okrug: null, score: total, age: 0,
    });
    // «b» дешевле «a» и не дальше — «a» не может быть первым даже при меньшей оценке.
    const list = [mk("a", 1000, 5), mk("b", 900, 5)];
    list[0].score = 1;
    expect(sortForTab(list, "optimal", null).map((q) => q.offer.id)).toEqual(["b", "a"]);
  });
});

describe("filters", () => {
  it("model and okrug options come with counts and prices", () => {
    const offers = [
      O({ id: "m1", priceDay: 500, modelSlug: "makita-hr2470", modelName: "Makita HR2470", place: at("yubileynyy") }),
      O({ id: "m2", priceDay: 600, modelSlug: "makita-hr2470", modelName: "Makita HR2470", place: at("festivalnyy") }),
      O({ id: "m3", priceDay: 700, place: inMd("komsomolskiy") }),
    ];
    const v = buildResultView(offers, emptyParams(TODAY), ctx);
    expect(v.prices.models).toEqual([{ slug: "makita-hr2470", name: "Makita HR2470", count: 2, min: 500 }]);
    expect(v.prices.okrugs.find((o) => o.slug === "karasunskiy")?.min).toBe(700);
    const onlyModel = buildResultView(offers, patchParams(emptyParams(TODAY), { filters: { models: ["makita-hr2470"] } }), ctx);
    expect(ids(onlyModel).sort()).toEqual(["m1", "m2"]);
  });

  it("«Работает сегодня» — по часам работы", () => {
    const offers = [
      O({ id: "open", priceDay: 800, hours: { wed: [["09:00", "20:00"]] } }),
      O({ id: "closed", priceDay: 500, hours: { mon: [["09:00", "20:00"]] } }),
      O({ id: "unknown", priceDay: 400 }),
    ];
    const v = buildResultView(offers, patchParams(emptyParams(TODAY), { filters: { openToday: true } }), ctx);
    expect(ids(v)).toEqual(["open"]);
  });
});

describe("card texts", () => {
  it("breakdown and deposit", () => {
    expect(quoteBreakdown(quote(O({ id: "x", priceDay: 400, minDays: 3 }), 2))).toBe("за 3 суток — минимальный срок проката");
    expect(quoteBreakdown(quote(O({ id: "x", priceDay: 400 }), 2))).toBe("за 2 суток");
    expect(depositLabel(O({ id: "x", priceDay: 1, depositRub: 0, depositDocument: true })).text).toBe("Без денежного залога — паспорт");
    expect(depositLabel(O({ id: "x", priceDay: 1, depositRub: null })).text).toBe("Залог уточняется");
  });
});

describe("regressions", () => {
  it("okrug tab keeps the own-okrug offer first even if another okrug is cheaper", () => {
    const offers = [
      O({ id: "mine", priceDay: 1000, place: at("tsentr") }), // Западный
      O({ id: "other", priceDay: 900, place: at("vitaminkombinat") }), // Прикубанский
    ];
    const v = buildResultView(offers, withLoc({ kind: "okrug", okrug: "zapadnyy" }, { tab: "okrug" }), ctx);
    expect(ids(v)[0]).toBe("mine");
    expect(v.tabs.find((t) => t.id === "okrug")?.best?.offer.id).toBe("mine");
    expect(v.explanation).toMatch(/^Дешевле всех в вашем округе; в городе есть на 100\s₽ дешевле$/);
    // На «Самом дешёвом» первой — тоже своя, и подпись не обещает «самый дешёвый за ваши даты».
    const cheap = buildResultView(offers, withLoc({ kind: "okrug", okrug: "zapadnyy" }, { tab: "cheapest" }), ctx);
    expect(cheap.tabs.find((t) => t.id === "cheapest")?.winnerLabel).toBe("Дешевле всех в вашем округе");
  });

  it("filter price equals the first total on the active tab, not only on «cheapest»", () => {
    const offers = [
      O({ id: "a", priceDay: 1000, depositRub: 0, place: at("yubileynyy") }),
      O({ id: "b", priceDay: 950, depositRub: 0, place: at("vitaminkombinat") }),
      O({ id: "c", priceDay: 900, place: at("festivalnyy") }),
    ];
    for (const tab of ["optimal", "nearest", "cheapest"] as const) {
      const p = withLoc(ymr, { tab });
      const price = buildResultView(offers, p, ctx).prices.noMoneyDeposit;
      const after = buildResultView(offers, patchParams(p, { filters: { noMoneyDeposit: true } }), ctx);
      expect(price, tab).toBe(after.sections[0].items[0].total);
    }
  });

  it("no «∞ times closer» when the offer is in the user's microdistrict centre", () => {
    const offers = [
      O({ id: "same", priceDay: 1000, place: inMd("yubileynyy") }),
      O({ id: "cheap", priceDay: 500, place: at("slavyanskiy") }),
    ];
    const v = buildResultView(offers, withLoc(ymr, { tab: "nearest" }), ctx);
    expect(v.explanation).not.toMatch(/∞|Infinity/);
    expect(v.explanation).toMatch(/меньше километра от вас|км от вас/);
  });

  it("summary counts shops that pass the filters", () => {
    const offers = [
      O({ id: "a", priceDay: 1000, claimed: true }),
      O({ id: "b", priceDay: 900 }),
      O({ id: "c", priceDay: 800 }),
    ];
    const v = buildResultView(offers, patchParams(emptyParams(TODAY), { filters: { claimed: true } }), ctx);
    expect(v.summary.shops).toBe(1);
  });
});
