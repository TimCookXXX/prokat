import { describe, expect, it } from "vitest";
import {
  buildSearchIndex, highlight, matchedBrand, normalize, resolveQuery, searchSuggestions, stem, switchLayout,
  transliterate, type SearchData,
} from "@/lib/compare/search";
import { CATALOG } from "@/lib/compare/catalog-data";
import { BRANDS, MODELS } from "@/lib/compare/models-data";
import { brandWordSet, modelAliasKeys, stopWordSet } from "@/lib/compare/models";

// Написания моделей — как в продакшене: ключи model_aliases (getSearchData), а не сырые строки.
const keyOpts = {
  brandWords: brandWordSet(BRANDS),
  stopWords: stopWordSet(CATALOG.flatMap((c) => c.groups.flatMap((g) => [g.name, ...g.classes.map((cl) => cl.name)]))),
};

// Индекс из настоящего справочника; у каждой модели «есть» прокат, у групп — цены.
const data: SearchData = {
  groups: CATALOG.flatMap((cat) => cat.groups.map((g) => ({
    slug: g.slug, name: g.name, nameGenitive: g.nameGenitive, category: cat.name, keywords: g.keywords ?? [],
    shops: 3, fromPrice: { rub: 500, per: "day" as const },
    classes: g.classes.map((c) => ({ slug: c.slug, name: c.name, shortHint: c.shortHint ?? null, keywords: c.keywords, chip: c.chip ?? null })),
  }))),
  brands: BRANDS,
  models: MODELS.map((m) => ({
    slug: m.slug, brand: m.brand, name: m.name, family: m.family ?? null,
    aliases: modelAliasKeys(m, BRANDS.find((b) => b.slug === m.brand)!, keyOpts),
    classSlug: m.cls,
    groupSlug: CATALOG.flatMap((c) => c.groups).find((g) => g.classes.some((c) => c.slug === m.cls))!.slug,
    shops: 2, fromDay: 500,
  })),
};
const index = buildSearchIndex(data);
const resolve = (q: string) => resolveQuery(index, q, data);

describe("normalization", () => {
  it("lowercases, folds ё and strips punctuation", () => {
    expect(normalize("  Проёмы, SDS-plus!  ")).toBe("проемы sds plus");
  });
  it("switches layout and transliterates both ways", () => {
    expect(switchLayout("gthajhfnjh")).toBe("перфоратор");
    expect(switchLayout("gepb")).toBe("пузи");
    expect(transliterate("пузи")).toBe("puzi");
    expect(transliterate("perforator")).toBe("перфоратор");
  });
  it("stems Russian endings", () => {
    expect(stem("перфоратора")).toBe("перфоратор");
    expect(stem("перфораторы")).toBe("перфоратор");
    expect(stem("моющего")).toBe("моющ");
  });
});

// ТЗ, п. 12, критерии 1–5.
describe("acceptance: search", () => {
  it("1. «пуззи», «ПУЗИ», «puzzi 8/1», «gepb 8/1» find Karcher Puzzi 8/1 C", () => {
    for (const q of ["пуззи 8/1", "ПУЗИ 8/1", "puzzi 8/1", "gepb 8/1", "puzzi8/1"]) {
      const r = resolve(q);
      expect(r.level, q).toBe("model");
      expect(r.level === "model" && r.target.modelSlugs, q).toEqual(["karcher-puzzi-8-1"]);
    }
    for (const q of ["пуззи", "ПУЗИ", "gepb"]) {
      expect(searchSuggestions(index, q).models.map((s) => s.title), q).toContain("Karcher Puzzi 8/1 C");
    }
  });

  it("2. «перфоратор» shows the whole perforator group", () => {
    expect(resolve("перфоратор")).toMatchObject({ level: "class", target: { groupSlug: "prokat-perforatora" } });
    expect(resolve("перфоратор").level === "class" && (resolve("перфоратор") as { target: { classSlug?: string } }).target.classSlug).toBeFalsy();
  });

  it("3. «пылесос» asks to choose: Моющий / Строительный", () => {
    const r = resolve("пылесос");
    expect(r.level).toBe("ambiguous");
    expect(r.level === "ambiguous" && r.chips.map((c) => c.label).sort()).toEqual(["Моющий", "Строительный"]);
  });

  it("4. genitive «перфоратора» and plural find the class", () => {
    for (const q of ["перфоратора", "перфораторы", "перфаратор"]) {
      expect(resolve(q), q).toMatchObject({ level: "class", target: { groupSlug: "prokat-perforatora" } });
    }
  });

  it("5. nothing found — similar classes are offered", () => {
    const r = resolve("кувалдометр");
    expect(r.level).toBe("none");
    expect(r.level === "none" && r.similar.length).toBeGreaterThan(0);
  });
});

describe("levels", () => {
  it("model by article, joined article and Cyrillic look-alike", () => {
    expect(resolve("HR2470")).toMatchObject({ level: "model", target: { modelSlugs: ["makita-hr2470"] } });
    expect(resolve("НR2470")).toMatchObject({ level: "model", target: { modelSlugs: ["makita-hr2470"] } });
    expect(resolve("gbh226")).toMatchObject({ level: "model", target: { modelSlugs: ["bosch-gbh-2-26"] } });
    expect(resolve("hr2470ft")).toMatchObject({ level: "model", target: { modelSlugs: ["makita-hr2470"] } });
  });

  it("several models of one class — class with a model filter", () => {
    const r = resolve("puzzi");
    expect(r).toMatchObject({ level: "model", target: { classSlug: "moyushchiy-pylesos" } });
    expect(r.level === "model" && r.target.modelSlugs?.sort()).toEqual(["karcher-puzzi-10-1", "karcher-puzzi-8-1"]);
  });

  it("brand + class", () => {
    expect(resolve("макита перфоратор")).toMatchObject({
      level: "brand", target: { groupSlug: "prokat-perforatora", brandSlug: "makita" },
    });
    expect(matchedBrand("керхер", data.brands)?.slug).toBe("karcher");
    expect(matchedBrand("ьфлшеф", data.brands)?.slug).toBe("makita");
  });

  it("brand alone across groups asks which group", () => {
    const r = resolve("керхер");
    expect(r.level).toBe("ambiguous");
    expect(r.level === "ambiguous" && r.chips.every((c) => c.target.brandSlug === "karcher")).toBe(true);
  });

  it("synonyms of groups", () => {
    expect(resolve("болгарка")).toMatchObject({ level: "class", target: { groupSlug: "prokat-bolgarki" } });
    expect(resolve("отбойник")).toMatchObject({ level: "class", target: { groupSlug: "prokat-otboynogo-molotka" } });
  });

  it("a class-specific word picks the class", () => {
    expect(resolve("перфоратор sds-max")).toMatchObject({ level: "class", target: { classSlug: "perforator-sds-max" } });
  });
});

describe("regressions", () => {
  it("service words and extra words do not turn a query into «not found»", () => {
    for (const [q, group] of [
      ["прокат перфоратора", "prokat-perforatora"],
      ["аренда болгарки в краснодаре", "prokat-bolgarki"],
      ["перфоратор на выходные", "prokat-perforatora"],
      ["генератор 5 квт", "prokat-generatora"],
      ["ушм 180", "prokat-bolgarki"],
      ["строительные леса", "prokat-vyshki-tury"],
      ["пылесос для химчистки", "prokat-moyushchego-pylesosa"],
      ["makita болгарка", "prokat-bolgarki"],
    ] as const) {
      const r = resolve(q);
      expect(r.level, q).not.toBe("none");
      if (r.level !== "none" && r.level !== "ambiguous") expect(r.target.groupSlug, q).toBe(group);
    }
  });

  it("models of one group across classes — the group with a model filter", () => {
    const r = resolve("hr");
    expect(r.level).toBe("model");
    expect(r.level === "model" && r.target).toMatchObject({ groupSlug: "prokat-perforatora" });
    expect(r.level === "model" && r.target.classSlug).toBeUndefined();
    expect(r.level === "model" && r.target.modelSlugs?.length).toBeGreaterThan(2);
  });

  it("fuzzy matching does not jump to unrelated tools or brands", () => {
    expect(resolve("бензорез").level === "class" && (resolve("бензорез") as { target: { groupSlug: string } }).target.groupSlug).not.toBe("prokat-generatora");
    expect(searchSuggestions(index, "makita").models.map((m) => m.title).join()).not.toMatch(/Maikaolin/);
    expect(searchSuggestions(index, "sds max").models.map((m) => m.target.classSlug)).not.toContain("perforator-sds-plus");
  });

  it("a single letter is not a query", () => {
    expect(resolve("с").level).toBe("none");
    expect(resolve("d").level).toBe("none");
  });
});

describe("suggestions", () => {
  it("models and classes, 5 each at most", () => {
    const s = searchSuggestions(index, "перфо");
    expect(s.classes[0]).toMatchObject({ kind: "group", title: "Перфоратор" });
    expect(s.models).toEqual([]);
    expect(s.classes.length).toBeLessThanOrEqual(5);
  });

  it("second word narrows to the brand", () => {
    const s = searchSuggestions(index, "перфо maki");
    expect(s.classes.map((x) => x.title)).toContain("Перфоратор SDS-plus Makita");
    expect(s.models.map((x) => x.title)).toEqual(expect.arrayContaining(["Makita HR2470", "Makita HR2630"]));
  });

  it("model subtitle has shops and price", () => {
    expect(searchSuggestions(index, "HR2470").models[0].subtitle).toBe("Перфоратор SDS-plus · 2 проката · от 500 ₽ в сутки");
  });

  it("empty query — popular groups", () => {
    expect(searchSuggestions(index, "").classes.length).toBeGreaterThan(0);
  });
});

describe("highlight", () => {
  it("marks matched word starts, also for converted forms", () => {
    expect(highlight("Перфоратор SDS-plus", "перфо")[0]).toEqual({ text: "Перфо", hit: true });
    expect(highlight("Makita HR2470", "макит")[0]).toEqual({ text: "Makit", hit: true });
  });
});
