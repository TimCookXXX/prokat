import { describe, expect, it } from "vitest";
import {
  type OfferInput, formatRub, isStale, minTotal, quote, rank, rentalDays, tabList, weekSavingsHint,
} from "@/lib/compare/pricing";

// Те же вымышленные данные, что в макетах и эталонных тестах пакета
// (docs/inrenta-pivot/code/pricing.test.ts): перфоратор SDS-plus, Краснодар.
const base = { itemClassId: "perforator-sds-plus", claimed: false, depositDocument: false };
const OFFERS: OfferInput[] = [
  { ...base, id: "a", shopId: "s-a", shopName: "Инструмент у дома", district: "ЮМР", priceDay: 450, priceWeek: 2400, minDays: 1, depositRub: 3000, delivery: { available: true, price: 400, freeFrom: 2000, sameDay: false }, verifiedAt: "2026-09-18", claimed: true },
  { ...base, id: "b", shopId: "s-b", shopName: "Бур и Молот", district: "ФМР", priceDay: 500, minDays: 1, depositRub: 0, depositDocument: true, delivery: { available: true, price: 350, sameDay: false }, verifiedAt: "2026-09-15" },
  { ...base, id: "c", shopId: "s-c", shopName: "РемПрокат-23", district: "Гидрострой", priceDay: 350, minDays: 2, depositRub: 2000, delivery: { available: false, price: 0, sameDay: false }, verifiedAt: "2026-09-20" },
  { ...base, id: "d", shopId: "s-d", shopName: "Склад на Уральской", district: "Энка", priceDay: 600, priceWeek: 3000, minDays: 1, depositRub: 5000, delivery: { available: true, price: 500, freeFrom: 3000, sameDay: false }, verifiedAt: "2026-09-12", claimed: true },
  { ...base, id: "e", shopId: "s-e", shopName: "Мастерская Фёдорова", district: "ЧМР", priceDay: 400, minDays: 1, depositRub: 2000, depositDocument: true, delivery: { available: true, price: 300, sameDay: false }, verifiedAt: "2026-08-02" },
  { ...base, id: "f", shopId: "s-f", shopName: "Точка инструмента", district: "Центр", priceDay: 900, minDays: 1, depositRub: 10000, delivery: { available: true, price: 0, sameDay: true }, verifiedAt: "2026-09-19" },
  { ...base, id: "g", shopId: "s-g", shopName: "Дрель и Ко", district: "Музыкальный", priceDay: 550, priceWeek: 2800, minDays: 1, depositRub: 3000, delivery: { available: true, price: 450, sameDay: true }, verifiedAt: "2026-09-17" },
  { ...base, id: "h", shopId: "s-h", shopName: "Прокат «Кран-Балка»", district: "Фестивальный", priceDay: 380, minDays: 3, depositRub: 1500, delivery: { available: true, price: 350, sameDay: false }, verifiedAt: "2026-09-16" },
];
const TODAY = "2026-09-23";

describe("pricing (эталон пакета)", () => {
  it("считает сутки по датам", () => {
    expect(rentalDays("2026-09-27", "2026-09-29")).toBe(2);
    expect(rentalDays("2026-09-27", "2026-09-27")).toBe(1);
  });

  const r = rank(OFFERS, { days: 2, needDelivery: true }, TODAY);

  it("ранжирует по итогу и не ставит в рейтинг устаревшие цены", () => {
    expect(r.ranked.map((q) => [q.offer.id, q.total])).toEqual([
      ["a", 1300], ["b", 1350], ["h", 1490], ["g", 1550], ["d", 1700], ["f", 1800],
    ]);
    expect(r.recheck.map((q) => q.offer.id)).toEqual(["e"]);
    expect(r.pickupOnly.map((q) => [q.offer.id, q.total])).toEqual([["c", 700]]);
  });

  it("учитывает минимальный срок", () => {
    const h = r.ranked.find((q) => q.offer.id === "h")!;
    expect(h.billedDays).toBe(3);
    expect(h.minApplied).toBe(true);
    expect(h.rent).toBe(1140);
  });

  it("вкладки", () => {
    expect(tabList(r, "noMoneyDeposit").map((q) => q.offer.id)).toEqual(["b"]);
    expect(tabList(r, "sameDay").map((q) => [q.offer.id, q.total])).toEqual([["g", 1550], ["f", 1800]]);
  });

  it("цены у фильтров", () => {
    expect(minTotal(r.ranked, (q) => q.offer.claimed)).toBe(1300);
    expect(minTotal(r.ranked, (q) => q.offer.minDays === 1)).toBe(1300);
  });

  it("недельный тариф и бесплатная доставка от суммы", () => {
    const week = rank(OFFERS, { days: 7, needDelivery: true }, TODAY);
    const a = week.ranked.find((q) => q.offer.id === "a")!;
    expect(a.rent).toBe(2400);
    expect(a.deliveryFee).toBe(0);
  });

  it("подсказка про неделю", () => {
    const hint = weekSavingsHint(r, { days: 2, needDelivery: true })!;
    expect(hint.offer.id).toBe("a");
    expect(hint.weekPrice).toBe(2400);
    expect(hint.dailyEquivalent).toBe(3150);
  });

  it("формат суммы", () => {
    expect(formatRub(1300)).toBe("1 300 ₽");
  });
});

describe("pricing: расширения", () => {
  // Электровелосипед курьеру: прокат сдаёт только понедельно.
  const weekly: OfferInput = {
    ...base, id: "w", shopId: "s-w", shopName: "Велопрокат", district: "Центр",
    priceDay: null, priceWeek: 3900, minDays: 1, depositRub: 3000,
    delivery: { available: false, price: 0, sameDay: false }, verifiedAt: "2026-09-20",
  };

  it("без суточной цены оплачиваются целые недели", () => {
    expect(quote(weekly, { days: 3, needDelivery: false })).toMatchObject({ billedDays: 7, rent: 3900, minApplied: true });
    expect(quote(weekly, { days: 7, needDelivery: false })).toMatchObject({ billedDays: 7, rent: 3900, minApplied: false });
    expect(quote(weekly, { days: 10, needDelivery: false })).toMatchObject({ billedDays: 14, rent: 7800 });
    expect(quote(weekly, { days: 28, needDelivery: false })).toMatchObject({ billedDays: 28, rent: 15600 });
  });

  it("понедельный прокат не даёт подсказку про неделю", () => {
    const r = rank([weekly], { days: 3, needDelivery: false }, TODAY);
    expect(weekSavingsHint(r, { days: 3, needDelivery: false })).toBeNull();
  });

  it("остаток дней после недель не дороже ещё одной недели", () => {
    const a = OFFERS[0]; // 450 ₽/сут, 2 400 ₽/нед
    expect(quote(a, { days: 9, needDelivery: false })!.rent).toBe(2400 + 900);
    expect(quote(a, { days: 13, needDelivery: false })!.rent).toBe(2400 + 2400);
  });

  it("цена старше 30 дней уходит на перепроверку ровно после 30-го дня", () => {
    const at = (verifiedAt: string) => ({ ...OFFERS[0], verifiedAt });
    expect(isStale(at("2026-08-24"), TODAY)).toBe(false); // 30 дней
    expect(isStale(at("2026-08-23"), TODAY)).toBe(true);  // 31 день
  });

  it("сутки через границу месяца и года", () => {
    expect(rentalDays("2026-09-29", "2026-10-02")).toBe(3);
    expect(rentalDays("2026-12-30", "2027-01-02")).toBe(3);
  });

  it("при равном итоге выше подтвердившая цены карточка", () => {
    const x = { ...OFFERS[1], id: "x", claimed: false };
    const y = { ...OFFERS[1], id: "y", claimed: true };
    const r = rank([x, y], { days: 1, needDelivery: false }, TODAY);
    expect(r.ranked.map((q) => q.offer.id)).toEqual(["y", "x"]);
  });

  it("устаревшая цена не становится победителем вкладки", () => {
    const cheapStale = { ...OFFERS[0], id: "old", priceDay: 10, verifiedAt: "2026-01-01" };
    const r = rank([...OFFERS, cheapStale], { days: 2, needDelivery: true }, TODAY);
    for (const tab of ["cheapest", "noMoneyDeposit", "sameDay"] as const) {
      expect(tabList(r, tab).map((q) => q.offer.id)).not.toContain("old");
    }
  });
});
