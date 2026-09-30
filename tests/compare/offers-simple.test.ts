import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isSimpleHeader, parseCheckedDate, parseDeposit, parseOffersFile, parseRub,
} from "@/lib/compare/offers-simple";
import { detectDelimiter } from "@/lib/compare/offers-csv";

const TODAY = "2026-09-26";
const HEAD = "Прокат,Адрес,Телефон,Что сдают,Модель,Цена за сутки,Цена за неделю,Минимум суток,Залог,В комплекте,Часы работы,Ссылка,Проверено";
const parse = (...lines: string[]) => parseOffersFile([HEAD, ...lines].join("\n"), TODAY);

describe("simple template", () => {
  it("the template file has only example rows", () => {
    const csv = readFileSync("docs/inrenta-pivot/data/prokaty.template.csv", "utf8");
    expect(parseOffersFile(csv, TODAY)).toEqual({ rows: [], errors: [] });
    // Без пометки «ПРИМЕР» строки шаблона разбираются без ошибок.
    expect(parseOffersFile(csv.replace(/ПРИМЕР /g, ""), TODAY)).toMatchObject({ errors: [], rows: { length: 3 } });
  });

  it("a row with an empty shop continues the shop above", () => {
    const { rows, errors } = parse(
      'Чистый дом,"ул. Красная, 120",8 (900) 123-45-67,моющий пылесос,Karcher Puzzi 8/1 C,1 000 ₽,5000р,,2000,,ежедневно 9-21,https://example.ru,20.09.2026',
      ",,,,Makita HR2470,500,,2 суток,паспорт,2 бура,,,",
    );
    expect(errors).toEqual([]);
    expect(rows[1]).toMatchObject({
      shopName: "Чистый дом", address: "ул. Красная, 120", phone: "+79001234567", citySlug: "krasnodar",
      classSlug: "perforator-sds-plus", model: "Makita HR2470", priceDay: 500, minDays: 2,
      depositRub: 0, depositDocument: true, includes: "2 бура", verifiedAt: "2026-09-20", verifiedBy: "site",
    });
    expect(rows[0]).toMatchObject({ classSlug: "moyushchiy-pylesos", priceDay: 1000, priceWeek: 5000, depositRub: 2000, minDays: 1 });
  });

  it("«Что сдают» in plain words; an ambiguous word asks to choose", () => {
    expect(parse("А,,,болгарка 230,,700,,,,,,,").rows[0].classSlug).toBe("ushm-230");
    expect(parse("А,,,Пароочиститель,,700,,,,,,,").rows[0].classSlug).toBe("paroochistitel");
    expect(parse("А,,,perforator-sds-max,,700,,,,,,,").rows[0].classSlug).toBe("perforator-sds-max");
    expect(parse("А,,,перфоратор,,700,,,,,,,").errors[0].message).toMatch(/уточните: Перфоратор SDS-plus или Перфоратор SDS-max/);
    expect(parse("А,,,пылесос,,700,,,,,,,").errors[0].message).toMatch(/уточните/);
    expect(parse("А,,,кувалдометр,,700,,,,,,,").errors[0].message).toMatch(/нет в каталоге/);
  });

  it("defaults: today, «call» without a link, avito — listing", () => {
    expect(parse("А,,,штроборез,,700,,,,,,,").rows[0]).toMatchObject({ verifiedAt: TODAY, verifiedBy: "call", depositRub: null });
    expect(parse("А,,,штроборез,,700,,,,,,avito.ru/krasnodar/x,").rows[0]).toMatchObject({
      verifiedBy: "listing", sourceUrl: "https://avito.ru/krasnodar/x",
    });
    expect(parse("А,,,штроборез,,700,,,,,,https://t.me/shop_tools,").rows[0].telegram).toBe("shop_tools");
  });

  it("errors are reported by line in plain Russian", () => {
    const { errors } = parse(",,,штроборез,,700,,,,,,,", "Б,,123,штроборез,,700,,,,,,,", "В,,,штроборез,,,,,,,,,");
    expect(errors.map((e) => [e.line, e.message.split(":")[0]])).toEqual([[2, "Прокат"], [3, "Телефон"], [4, "Цена за сутки"]]);
  });

  it("semicolon-separated export (Excel, Numbers with Russian settings)", () => {
    const csv = `${HEAD.replaceAll(",", ";")}\nА;"ул. Северная, 15";;штроборез;;700;;;;;;;`;
    expect(detectDelimiter(csv)).toBe(";");
    expect(parseOffersFile(csv, TODAY).rows[0]).toMatchObject({ address: "ул. Северная, 15", priceDay: 700 });
  });

  it("the full template still goes to the full parser", () => {
    expect(isSimpleHeader(["city_slug", "shop_name"])).toBe(false);
    expect(isSimpleHeader(["Название", "Цена"])).toBe(true);
    const full = readFileSync("docs/inrenta-pivot/data/offers.template.csv", "utf8");
    expect(parseOffersFile(full, TODAY).errors.every((e) => /пример/.test(e.message))).toBe(true);
  });
});

describe("values", () => {
  it("prices", () => {
    expect(parseRub("1 000 ₽", "Цена")).toBe(1000);
    expect(parseRub("1000 руб.", "Цена")).toBe(1000);
    expect(parseRub("", "Цена")).toBeNull();
    expect(() => parseRub("1000-1500", "Цена")).toThrow(/цена в рублях/);
  });

  it("deposit", () => {
    expect(parseDeposit("")).toEqual({ rub: null, document: false });
    expect(parseDeposit("нет")).toEqual({ rub: 0, document: false });
    expect(parseDeposit("без залога")).toEqual({ rub: 0, document: false });
    expect(parseDeposit("Паспорт")).toEqual({ rub: 0, document: true });
    expect(parseDeposit("3 000 + паспорт")).toEqual({ rub: 3000, document: true });
    expect(() => parseDeposit("договоримся")).toThrow(/Залог/);
  });

  it("check dates", () => {
    expect(parseCheckedDate("", TODAY)).toBe(TODAY);
    expect(parseCheckedDate("20.09.2026", TODAY)).toBe("2026-09-20");
    expect(parseCheckedDate("20.09.26", TODAY)).toBe("2026-09-20");
    expect(parseCheckedDate("5.9", TODAY)).toBe("2026-09-05");
    expect(() => parseCheckedDate("30.02.2026", TODAY)).toThrow(/нет такой даты/);
    expect(() => parseCheckedDate("01.10.2026", TODAY)).toThrow(/будущем/);
  });
});
