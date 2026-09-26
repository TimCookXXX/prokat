import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { normalizePhone, parseCsv, parseOffersCsv, OFFER_COLUMNS } from "@/lib/compare/offers-csv";

const TODAY = "2026-09-23";
const HEADER = OFFER_COLUMNS.join(",");

// Строка в порядке OFFER_COLUMNS; неуказанные колонки пустые.
function row(fields: Partial<Record<(typeof OFFER_COLUMNS)[number], string>>): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return OFFER_COLUMNS.map((c) => cell(fields[c] ?? "")).join(",");
}

const BASE = {
  city_slug: "krasnodar",
  shop_name: "Инструмент у дома",
  class_slug: "perforator-sds-plus",
  price_day: "450",
  verified_at: "2026-09-18",
};

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas and newlines inside cells", () => {
    const records = parseCsv('a,b\n"x, ""y""","multi\nline"\n');
    expect(records).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 2, cells: ['x, "y"', "multi\nline"] },
    ]);
  });

  it("strips BOM, accepts CRLF and skips blank lines", () => {
    const records = parseCsv("﻿a,b\r\n\r\n1,2\r\n");
    expect(records).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 3, cells: ["1", "2"] },
    ]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('a\n"oops')).toThrow(/кавычка/);
  });
});

describe("normalizePhone", () => {
  it("normalizes Russian numbers to +7XXXXXXXXXX", () => {
    expect(normalizePhone("8 (918) 123-45-67")).toBe("+79181234567");
    expect(normalizePhone("+7 918 123 45 67")).toBe("+79181234567");
    expect(normalizePhone("9181234567")).toBe("+79181234567");
  });

  it("rejects non-Russian or short numbers", () => {
    expect(normalizePhone("123-45-67")).toBeNull();
    expect(normalizePhone("+1 202 555 0100")).toBeNull();
  });
});

describe("parseOffersCsv", () => {
  it("normalizes a full row", () => {
    const csv = [HEADER, row({
      ...BASE, microdistrict: " ЮМР ", phone: "8 900 100-00-01", model: "Makita HR2470",
      price_week: "2 400", min_days: "", deposit_rub: "3000", deposit_document: "нет",
      delivery_available: "true", delivery_price: "400", delivery_free_from: "2000",
      delivery_same_day: "false", verified_by: "site", source_url: "https://example.ru/x",
    })].join("\n");
    const { rows, errors } = parseOffersCsv(csv, TODAY);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{
      line: 2, citySlug: "krasnodar", shopName: "Инструмент у дома", microdistrict: "ЮМР",
      address: null, lat: null, lon: null, hours: null, telegram: null,
      phone: "+79001000001", website: null, classSlug: "perforator-sds-plus",
      model: "Makita HR2470", includes: null, priceDay: 450, priceWeek: 2400, minDays: 1, depositRub: 3000,
      depositDocument: false, deliveryAvailable: true, deliveryPrice: 400, deliveryFreeFrom: 2000,
      deliverySameDay: false, verifiedAt: "2026-09-18", verifiedBy: "site",
      sourceUrl: "https://example.ru/x",
    }]);
  });

  it("reads place, hours, messenger and what is included", () => {
    const csv = [HEADER, row({
      ...BASE, address: "ул. Северная, 15", lat: "45,0621", lon: "38.952", hours: "пн-пт 9-20; сб 10-16",
      telegram: "https://t.me/burmolot", includes: "2 бура",
    })].join("\n");
    const { rows, errors } = parseOffersCsv(csv, TODAY);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      address: "ул. Северная, 15", lat: 45.0621, lon: 38.952, telegram: "burmolot", includes: "2 бура",
      hours: { mon: [["09:00", "20:00"]], fri: [["09:00", "20:00"]], sat: [["10:00", "16:00"]] },
    });
  });

  it("rejects half coordinates and unreadable hours", () => {
    const csv = [HEADER, row({ ...BASE, lat: "45.06" }), row({ ...BASE, shop_name: "Другой", hours: "всегда" })].join("\n");
    expect(parseOffersCsv(csv, TODAY).errors.map((e) => e.line)).toEqual([2, 3]);
  });

  it("still understands the old «district» column", () => {
    const csv = "city_slug,shop_name,district,class_slug,price_day,verified_at\nkrasnodar,Бур и Молот,ФМР,perforator-sds-plus,500,2026-09-15";
    expect(parseOffersCsv(csv, TODAY).rows[0].microdistrict).toBe("ФМР");
  });

  it("keeps unknown deposit apart from no deposit", () => {
    const csv = [HEADER, row({ ...BASE, deposit_rub: "" }), row({ ...BASE, shop_name: "Другой", deposit_rub: "0" })].join("\n");
    const { rows } = parseOffersCsv(csv, TODAY);
    expect(rows.map((r) => r.depositRub)).toEqual([null, 0]);
  });

  it("accepts a weekly-only offer but not one without any price", () => {
    const csv = [HEADER, row({ ...BASE, price_day: "", price_week: "3900" }), row({ ...BASE, shop_name: "Другой", price_day: "" })].join("\n");
    const { rows, errors } = parseOffersCsv(csv, TODAY);
    expect(rows.map((r) => [r.priceDay, r.priceWeek])).toEqual([[null, 3900]]);
    expect(errors).toEqual([{ line: 3, message: "price_day: пусто, и нет price_week" }]);
  });

  it("accepts a header with only the required columns", () => {
    const csv = "city_slug,shop_name,class_slug,price_day,verified_at\nkrasnodar,Бур и Молот,perforator-sds-plus,500,2026-09-15";
    const { rows, errors } = parseOffersCsv(csv, TODAY);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ minDays: 1, depositRub: null, deliveryAvailable: false, verifiedBy: "call" });
  });

  it("rejects the example rows of the template", () => {
    const template = readFileSync("docs/inrenta-pivot/data/offers.template.csv", "utf8");
    const { rows, errors } = parseOffersCsv(template, TODAY);
    expect(rows).toEqual([]);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(errors[0].message).toMatch(/пример/);
  });

  it("reports header problems before looking at rows", () => {
    expect(parseOffersCsv("city_slug,shop,price_day\nx,y,1", TODAY).errors).toEqual([
      { line: 1, message: "Неизвестные колонки: shop" },
      { line: 1, message: "Нет обязательных колонок: shop_name, class_slug, verified_at" },
    ]);
    expect(parseOffersCsv("city_slug,shop_name\nx,y", TODAY).errors[0].message)
      .toMatch(/Нет обязательных колонок: class_slug, price_day, verified_at/);
  });

  it("collects row errors with line numbers", () => {
    const csv = [
      HEADER,
      row({ ...BASE, price_day: "450.5" }),
      row({ ...BASE, verified_at: "2026-09-30" }),
      row({ ...BASE, verified_at: "2026-02-30" }),
      row({ ...BASE, delivery_same_day: "true" }),
      row({ ...BASE, phone: "12345" }),
      row({ ...BASE, verified_by: "guess" }),
      row({ ...BASE, source_url: "ftp://x" }),
      row({ ...BASE, price_day: "" }),
    ].join("\n");
    const { rows, errors } = parseOffersCsv(csv, TODAY);
    expect(rows).toEqual([]);
    expect(errors.map((e) => [e.line, e.message.split(":")[0]])).toEqual([
      [2, "price_day"],
      [3, "verified_at"],
      [4, "verified_at"],
      [5, "доставка"],
      [6, "phone"],
      [7, "verified_by"],
      [8, "source_url"],
      [9, "price_day"],
    ]);
  });

  it("flags the same shop, class and model twice", () => {
    const csv = [HEADER, row({ ...BASE, model: "Makita" }), row({ ...BASE, model: "MAKITA", price_day: "500" })].join("\n");
    const { rows, errors } = parseOffersCsv(csv, TODAY);
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([{ line: 3, message: "повтор строки 2: тот же прокат, класс и модель" }]);
  });
});
