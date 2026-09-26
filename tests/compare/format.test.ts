import { describe, it, expect } from "vitest";
import { compareTitle, dateRangeLabel, daysLabel, formatPhone, shopsGenitive, shopsLabel, shortDate } from "@/lib/compare/format";
import { buildFaq } from "@/lib/compare/faq";
import type { OfferInput } from "@/lib/compare/pricing";

describe("compare formats", () => {
  it("formats dates like the design system", () => {
    expect(shortDate("2026-09-18")).toBe("18 сен");
    expect(dateRangeLabel("2026-09-26", "2026-09-28")).toBe("сб 26 — пн 28 сен");
    expect(dateRangeLabel("2026-09-30", "2026-10-02")).toBe("ср 30 сен — пт 2 окт");
  });

  it("declines days and shops", () => {
    expect([1, 2, 5, 21].map(daysLabel)).toEqual(["1 сутки", "2 суток", "5 суток", "21 сутки"]);
    expect([1, 3, 8].map(shopsLabel)).toEqual(["1 прокат", "3 проката", "8 прокатов"]);
    expect([1, 2, 5].map(shopsGenitive)).toEqual(["1 проката", "2 прокатов", "5 прокатов"]);
  });

  it("formats phones and titles", () => {
    expect(formatPhone("+79181234567")).toBe("+7 918 123-45-67");
    expect(compareTitle({ seoWord: "prokat", nameGenitive: "перфоратора" }, { name: "Краснодар", namePrepositional: "Краснодаре" }))
      .toBe("Прокат перфоратора в Краснодаре");
    expect(compareTitle({ seoWord: "arenda", nameGenitive: "электровелосипеда Kugoo U5" }, { name: "Сочи", namePrepositional: null }))
      .toBe("Аренда электровелосипеда Kugoo U5 в Сочи");
  });
});

describe("buildFaq", () => {
  const offer = (o: Partial<OfferInput>): OfferInput => ({
    id: "x", shopId: "s", shopName: "S", itemClassId: "c", district: "", priceDay: 500, minDays: 1, depositRub: 0,
    depositDocument: true, delivery: { available: true, price: 300, sameDay: false }, verifiedAt: "2026-09-20", claimed: false, ...o,
  });

  it("answers from fresh offers only", () => {
    const faq = buildFaq({
      title: "Прокат перфоратора",
      cityIn: "в Краснодаре",
      today: "2026-09-23",
      offers: [
        offer({ id: "1", shopId: "a" }),
        offer({ id: "2", shopId: "b", priceDay: 100, verifiedAt: "2026-01-01" }), // устарела
        offer({ id: "3", shopId: "c", priceDay: 700, depositRub: 5000, depositDocument: false, delivery: { available: true, price: 0, sameDay: true } }),
      ],
    });
    expect(faq[0]).toEqual({
      q: "Сколько стоит прокат перфоратора в Краснодаре?",
      a: "Суточная цена — от 500 ₽ у 2 прокатов в Краснодаре. Итог за 1 сутки с доставкой — от 700 ₽: мы сразу добавляем доставку и учитываем минимальный срок проката.",
    });
    expect(faq[1].a).toContain("Без денежного залога — 1 из 2 предложений (часть просит паспорт).");
    expect(faq[2].a).toBe("Доставка в день заказа есть у 1 проката — смотрите вкладку «Привезут сегодня».");
  });

  it("keeps the general answers without offers", () => {
    expect(buildFaq({ title: "Прокат штробореза", cityIn: "в Краснодаре", today: "2026-09-23", offers: [] }).map((f) => f.q))
      .toEqual(["Откуда цены и насколько они свежие?", "Как платить и оформлять аренду?"]);
  });
});
