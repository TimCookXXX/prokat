import { describe, it, expect } from "vitest";
import { bookingFormSchema, normalizePhone } from "@/lib/booking/validation";

describe("normalizePhone()", () => {
  it("нормализует российские форматы к +7", () => {
    expect(normalizePhone("+7 900 111-22-33")).toBe("+79001112233");
    expect(normalizePhone("8 (900) 111 22 33")).toBe("+79001112233");
    expect(normalizePhone("79001112233")).toBe("+79001112233");
  });

  it("иностранные номера сохраняются как есть с +", () => {
    expect(normalizePhone("+375 29 123 45 67")).toBe("+375291234567");
  });

  it("мусор и короткие номера — пустая строка", () => {
    expect(normalizePhone("нет")).toBe("");
    expect(normalizePhone("12345")).toBe("");
    expect(normalizePhone("")).toBe("");
  });
});

describe("bookingFormSchema", () => {
  const valid = {
    listingId: "01ABC",
    from: "2026-07-20",
    to: "2026-07-22",
    qty: "2",
    priceDay: "500",
    phone: "8 900 111-22-33",
    comment: "  Привезите к подъезду  ",
  };

  it("парсит валидную форму, нормализует телефон и trim'ит комментарий", () => {
    const r = bookingFormSchema.parse(valid);
    expect(r.phone).toBe("+79001112233");
    expect(r.qty).toBe(2);
    expect(r.comment).toBe("Привезите к подъезду");
    expect(r.website).toBe("");
  });

  it("отклоняет пустой/мусорный телефон", () => {
    expect(bookingFormSchema.safeParse({ ...valid, phone: "" }).success).toBe(false);
    expect(bookingFormSchema.safeParse({ ...valid, phone: "позвоните" }).success).toBe(false);
  });

  /* Цена ездит с формой, чтобы поймать её сдвиг, — значит она обязательна и
   * такая же целая положительная, как количество. Мусор в ней не должен
   * проезжать: сверка с объявлением сравнивает числа. */
  it("отклоняет форму без цены и с мусорной ценой", () => {
    const { priceDay: _drop, ...without } = valid;
    expect(bookingFormSchema.safeParse(without).success).toBe(false);
    expect(bookingFormSchema.safeParse({ ...valid, priceDay: "0" }).success).toBe(false);
    expect(bookingFormSchema.safeParse({ ...valid, priceDay: "-100" }).success).toBe(false);
    expect(bookingFormSchema.safeParse({ ...valid, priceDay: "дорого" }).success).toBe(false);
  });

  it("отклоняет кривые даты и qty", () => {
    expect(bookingFormSchema.safeParse({ ...valid, from: "20.07.2026" }).success).toBe(false);
    expect(bookingFormSchema.safeParse({ ...valid, qty: "0" }).success).toBe(false);
    expect(bookingFormSchema.safeParse({ ...valid, qty: "1.5" }).success).toBe(false);
  });

  it("комментарий длиннее 500 — отказ", () => {
    expect(bookingFormSchema.safeParse({ ...valid, comment: "x".repeat(501) }).success).toBe(false);
  });
});
