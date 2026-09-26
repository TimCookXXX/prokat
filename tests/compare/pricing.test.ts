import { describe, expect, it } from "vitest";
import {
  type OfferInput, formatRub, isStale, minTotal, priceAll, quote, rentalDays, weekSavingsHint,
} from "@/lib/compare/pricing";

// Вымышленные данные макетов: перфоратор SDS-plus, Краснодар. Версия 1 — только
// самовывоз: условия доставки есть в данных, но в итог не входят.
const base = { itemClassId: "perforator-sds-plus", claimed: false, depositDocument: false };
const OFFERS: OfferInput[] = [
  { ...base, id: "a", shopId: "s-a", shopName: "Инструмент у дома", district: "ЮМР", priceDay: 450, priceWeek: 2400, minDays: 1, depositRub: 3000, delivery: { available: true, price: 400, freeFrom: 2000, sameDay: false }, verifiedAt: "2026-09-18", claimed: true },
  { ...base, id: "b", shopId: "s-b", shopName: "Бур и Молот", district: "ФМР", priceDay: 500, minDays: 1, depositRub: 0, depositDocument: true, delivery: { available: true, price: 350, sameDay: false }, verifiedAt: "2026-09-15" },
  { ...base, id: "c", shopId: "s-c", shopName: "РемПрокат-23", district: "Гидрострой", priceDay: 350, minDays: 2, depositRub: 2000, delivery: { available: false, price: 0, sameDay: false }, verifiedAt: "2026-09-20" },
  { ...base, id: "d", shopId: "s-d", shopName: "Склад на Уральской", district: "КМР", priceDay: 600, priceWeek: 3000, minDays: 1, depositRub: 5000, delivery: { available: true, price: 500, freeFrom: 3000, sameDay: false }, verifiedAt: "2026-09-12", claimed: true },
  { ...base, id: "e", shopId: "s-e", shopName: "Мастерская Фёдорова", district: "ЧМР", priceDay: 400, minDays: 1, depositRub: 2000, depositDocument: true, delivery: { available: true, price: 300, sameDay: false }, verifiedAt: "2026-08-02" },
  { ...base, id: "f", shopId: "s-f", shopName: "Точка инструмента", district: "Центр", priceDay: 900, minDays: 1, depositRub: 10000, delivery: { available: true, price: 0, sameDay: true }, verifiedAt: "2026-09-19" },
  { ...base, id: "g", shopId: "s-g", shopName: "Дрель и Ко", district: "", priceDay: 550, priceWeek: 2800, minDays: 1, depositRub: 3000, delivery: { available: true, price: 450, sameDay: true }, verifiedAt: "2026-09-17" },
  { ...base, id: "h", shopId: "s-h", shopName: "Прокат «Кран-Балка»", district: "Славянский", priceDay: 380, minDays: 3, depositRub: 1500, delivery: { available: true, price: 350, sameDay: false }, verifiedAt: "2026-09-16" },
];
const TODAY = "2026-09-23";

describe("pricing: итог за самовывоз", () => {
  // ТЗ, критерий 6.
  it("«сб 27 — пн 29 сен» — 2 суток; тот же день — 1 сутки", () => {
    expect(rentalDays("2026-09-27", "2026-09-29")).toBe(2);
    expect(rentalDays("2026-09-27", "2026-09-27")).toBe(1);
  });

  const r = priceAll(OFFERS, 2, TODAY);

  it("по возрастанию итога; доставка не влияет; старые цены — отдельно", () => {
    expect(r.fresh.map((q) => [q.offer.id, q.total])).toEqual([
      ["c", 700], ["a", 900], ["b", 1000], ["g", 1100], ["h", 1140], ["d", 1200], ["f", 1800],
    ]);
    expect(r.recheck.map((q) => q.offer.id)).toEqual(["e"]);
  });

  // ТЗ, критерий 8.
  it("минимальный срок 3 суток при запросе на 2 — итог за 3 и пометка", () => {
    expect(quote(OFFERS[7], 2)).toMatchObject({ billedDays: 3, total: 1140, minApplied: true });
  });

  // ТЗ, критерий 9.
  it("7 суток при недельном тарифе 2 400 ₽ — 2 400 ₽", () => {
    expect(quote(OFFERS[0], 7).total).toBe(2400);
  });

  it("остаток дней после недель не дороже ещё одной недели", () => {
    expect(quote(OFFERS[0], 9).total).toBe(2400 + 900);
    expect(quote(OFFERS[0], 13).total).toBe(2400 + 2400);
  });

  it("цены у фильтров — минимальный итог", () => {
    expect(minTotal(r.fresh, (q) => q.offer.claimed)).toBe(900);
    expect(minTotal(r.fresh, (q) => q.offer.minDays === 1)).toBe(900);
  });

  it("подсказка про неделю — самая низкая недельная цена", () => {
    const hint = weekSavingsHint(r.fresh, 2)!;
    expect(hint).toMatchObject({ weekPrice: 2400, dailyEquivalent: 3150 });
    expect(hint.offer.id).toBe("a");
    expect(weekSavingsHint(r.fresh, 7)).toBeNull();
  });

  it("формат суммы", () => {
    expect(formatRub(1300).replace(/\s/g, " ")).toBe("1 300 ₽");
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
    expect(quote(weekly, 3)).toMatchObject({ billedDays: 7, total: 3900, minApplied: true });
    expect(quote(weekly, 7)).toMatchObject({ billedDays: 7, total: 3900, minApplied: false });
    expect(quote(weekly, 10)).toMatchObject({ billedDays: 14, total: 7800 });
  });

  it("понедельный прокат не даёт подсказку про неделю", () => {
    expect(weekSavingsHint(priceAll([weekly], 3, TODAY).fresh, 3)).toBeNull();
  });

  // ТЗ, п. 4.5: старше 30 дней — «на перепроверке».
  it("цена уходит на перепроверку ровно после 30-го дня", () => {
    const at = (verifiedAt: string) => ({ ...OFFERS[0], verifiedAt });
    expect(isStale(at("2026-08-24"), TODAY)).toBe(false);
    expect(isStale(at("2026-08-23"), TODAY)).toBe(true);
  });

  it("сутки через границу месяца и года", () => {
    expect(rentalDays("2026-09-29", "2026-10-02")).toBe(3);
    expect(rentalDays("2026-12-30", "2027-01-02")).toBe(3);
  });

  it("при равном итоге выше подтвердившая цены карточка", () => {
    const x = { ...OFFERS[1], id: "x", claimed: false };
    const y = { ...OFFERS[1], id: "y", claimed: true };
    expect(priceAll([x, y], 1, TODAY).fresh.map((q) => q.offer.id)).toEqual(["y", "x"]);
  });
});
