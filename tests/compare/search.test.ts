import { describe, expect, it } from "vitest";
import {
  buildSearchIndex, highlight, modelMatches, normalize, searchSuggestions, switchLayout, transliterate,
  type SearchGroupInput, type SearchModelInput,
} from "@/lib/compare/search";

const groups: SearchGroupInput[] = [
  {
    slug: "prokat-perforatora", name: "Перфоратор", nameGenitive: "перфоратора", category: "Инструменты",
    keywords: ["перф", "бурилка"], shops: 8, fromPrice: { rub: 380, per: "day" },
    classes: [
      { slug: "perforator-sds-plus", name: "Перфоратор SDS-plus", shortHint: "2–4 Дж · дюбели, штробы, плитка" },
      { slug: "perforator-sds-max", name: "Перфоратор SDS-max", shortHint: "5–12 Дж · монолит, проёмы" },
    ],
  },
  {
    slug: "prokat-bolgarki", name: "УШМ (болгарка)", nameGenitive: "болгарки", category: "Инструменты",
    keywords: ["болгарка", "ушм", "турбинка"], shops: 2, fromPrice: { rub: 300, per: "day" },
    classes: [
      { slug: "ushm-125", name: "УШМ 125 мм", shortHint: "металл, профиль, плитка" },
      { slug: "ushm-230", name: "УШМ 230 мм", shortHint: "бетон, камень" },
    ],
  },
  {
    slug: "prokat-shtroboreza", name: "Штроборез", nameGenitive: "штробореза", category: "Инструменты",
    keywords: ["штроба"], shops: 0, fromPrice: null,
    classes: [{ slug: "shtroborez", name: "Штроборез", shortHint: "штробы под проводку" }],
  },
];

const models: SearchModelInput[] = [
  { groupSlug: "prokat-perforatora", classSlug: "perforator-sds-plus", model: "Makita HR2470", shops: 2, fromDay: 380 },
  { groupSlug: "prokat-perforatora", classSlug: "perforator-sds-plus", model: "Makita HR2630", shops: 1, fromDay: 550 },
  { groupSlug: "prokat-perforatora", classSlug: "perforator-sds-plus", model: "Bosch GBH 2-26", shops: 1, fromDay: 500 },
  { groupSlug: "prokat-perforatora", classSlug: "perforator-sds-max", model: "Hilti TE 2", shops: 1, fromDay: 900 },
];

const index = buildSearchIndex(groups, models);
const titles = (q: string) => searchSuggestions(index, q).map((s) => s.title);

describe("normalize / layout / translit", () => {
  it("lowercases, folds ё and strips punctuation", () => {
    expect(normalize("  Проёмы, SDS-plus!  ")).toBe("проемы sds plus");
  });
  it("switches keyboard layout both ways", () => {
    expect(switchLayout("gthajhfnjh")).toBe("перфоратор");
    expect(switchLayout("ьфлшеф")).toBe("makita");
  });
  it("transliterates both ways", () => {
    expect(transliterate("perforator")).toBe("перфоратор");
    expect(transliterate("макита")).toBe("makita");
  });
});

describe("searchSuggestions", () => {
  it("prefix of a group shows the group and its classes, not every model", () => {
    const r = searchSuggestions(index, "перфо");
    expect(r[0]).toMatchObject({ kind: "group", title: "Перфоратор" });
    expect(r.map((s) => s.kind)).toEqual(["group", "class", "class"]);
    expect(r.slice(1).map((s) => s.classSlug)).toEqual(["perforator-sds-plus", "perforator-sds-max"]);
  });

  it("second word narrows to the brand inside the group", () => {
    const r = searchSuggestions(index, "перфо maki");
    expect(r.map((s) => s.title)).toEqual(["Перфоратор SDS-plus Makita", "Makita HR2470", "Makita HR2630"]);
    expect(r[0]).toMatchObject({ kind: "brand", model: "Makita", classSlug: "perforator-sds-plus" });
    expect(r[1]).toMatchObject({ kind: "model", model: "Makita HR2470" });
  });

  it("finds a model by digits and by a spaced or joined article", () => {
    expect(titles("2470")).toEqual(["Makita HR2470"]);
    expect(titles("gbh226")).toEqual(["Bosch GBH 2-26"]);
    expect(titles("gbh 2-26")).toEqual(["Bosch GBH 2-26"]);
  });

  it("finds by synonyms", () => {
    expect(titles("болгарка")[0]).toBe("УШМ (болгарка)");
    expect(titles("турбин")[0]).toBe("УШМ (болгарка)");
    expect(titles("бурилка")).toEqual(["Перфоратор"]);
  });

  it("forgives wrong layout, translit, Russian brand names and typos", () => {
    expect(titles("gthajh")[0]).toBe("Перфоратор");
    expect(titles("perforator")[0]).toBe("Перфоратор");
    expect(titles("макита")[0]).toBe("Перфоратор SDS-plus Makita");
    expect(titles("бош")).toContain("Bosch GBH 2-26");
    expect(titles("хилти")).toEqual(["Hilti TE 2"]);
    expect(titles("пефоратор")[0]).toBe("Перфоратор");
  });

  it("does not list a single class separately from its group", () => {
    expect(titles("штроб")).toEqual(["Штроборез"]);
  });

  it("shows a group without prices, but below groups with prices", () => {
    const r = searchSuggestions(index, "штроб");
    expect(r[0].subtitle).toContain("цены собираем");
  });

  it("returns nothing for gibberish", () => {
    expect(titles("кувалдометр")).toEqual([]);
  });

  it("empty query shows popular groups with prices", () => {
    expect(titles("")).toEqual(["Перфоратор", "УШМ (болгарка)"]);
  });

  it("subtitle of a group has shops and price from", () => {
    expect(searchSuggestions(index, "перфоратор")[0].subtitle).toBe("Инструменты · 8 прокатов · от 380 ₽ в сутки");
  });
});

describe("highlight", () => {
  it("marks matched word starts", () => {
    expect(highlight("Перфоратор SDS-plus", "перфо sd")).toEqual([
      { text: "Перфо", hit: true }, { text: "ратор", hit: false }, { text: " ", hit: false },
      { text: "SD", hit: true }, { text: "S", hit: false }, { text: "-", hit: false }, { text: "plus", hit: false },
    ]);
  });
});

describe("highlight — converted forms", () => {
  it("highlights a brand typed in Cyrillic or in the wrong layout", () => {
    expect(highlight("Makita HR2470", "макит")[0]).toEqual({ text: "Makit", hit: true });
    expect(highlight("Перфоратор", "gthaj")[0]).toEqual({ text: "Перфо", hit: true });
  });
});

describe("modelMatches", () => {
  it("matches exact model or whole brand, case-insensitively", () => {
    expect(modelMatches("Makita HR2470")("makita hr2470")).toBe(true);
    expect(modelMatches("Makita")("Makita HR2630")).toBe(true);
    expect(modelMatches("Makita")("Makitax 1")).toBe(false);
    expect(modelMatches("Makita")(null)).toBe(false);
    expect(modelMatches(null)(null)).toBe(true);
  });
});
