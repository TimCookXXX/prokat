import { describe, expect, it } from "vitest";
import {
  brandWordSet, fixHomoglyphs, modelAliasKeys, modelKey, offerModelKey, stopWordSet,
} from "@/lib/compare/models";
import { BRANDS, MODELS } from "@/lib/compare/models-data";
import { CATALOG } from "@/lib/compare/catalog-data";

const opts = {
  brandWords: brandWordSet(BRANDS),
  stopWords: stopWordSet(CATALOG.flatMap((c) => c.groups.flatMap((g) => [g.name, ...g.classes.map((cl) => cl.name)]))),
};

describe("modelKey", () => {
  it("ignores case, spaces, hyphens, dots and slashes", () => {
    expect(modelKey("Puzzi 8/1 C", opts)).toBe("puzzi81c");
    expect(modelKey("puzzi8/1c", opts)).toBe("puzzi81c");
    expect(modelKey("GBH 2-26", opts)).toBe(modelKey("gbh2.26", opts));
  });

  it("drops service words and the brand when there is an article", () => {
    expect(modelKey("Перфоратор Makita HR2470FT", opts)).toBe("hr2470ft");
    expect(modelKey("аренда Макита HR 2470", opts)).toBe("hr2470");
    expect(modelKey("Керхер Puzzi 8/1 C", opts)).toBe("puzzi81c");
  });

  it("treats Cyrillic look-alikes inside a Latin article as Latin", () => {
    expect(fixHomoglyphs("НR2470")).toBe("HR2470");
    expect(modelKey("Makita НR2470", opts)).toBe("hr2470");
    // Чисто кириллический артикул не трогаем.
    expect(modelKey("Зубр ЗП-26", opts)).toBe("зп26");
  });

  it("keeps the article digits even when class names contain numbers", () => {
    expect(opts.stopWords.has("125")).toBe(false);
    expect(modelKey("УШМ Bosch GWS 125", opts)).toBe("gws125");
  });
});

describe("modelAliasKeys", () => {
  it("covers the canonical name, the family and the variants", () => {
    const puzzi = MODELS.find((m) => m.slug === "karcher-puzzi-8-1")!;
    const karcher = BRANDS.find((b) => b.slug === "karcher")!;
    expect(modelAliasKeys(puzzi, karcher, opts)).toEqual(expect.arrayContaining(["puzzi81c", "puzzi81"]));
  });

  it("gives every catalog model its own keys", () => {
    const owner = new Map<string, string>();
    for (const m of MODELS) {
      const brand = BRANDS.find((b) => b.slug === m.brand)!;
      expect(brand, m.slug).toBeDefined();
      for (const k of modelAliasKeys(m, brand, opts)) {
        expect(owner.get(k) ?? m.slug, `«${k}»`).toBe(m.slug);
        owner.set(k, m.slug);
      }
    }
  });

  it("points every model to an existing class", () => {
    const classSlugs = new Set(CATALOG.flatMap((c) => c.groups.flatMap((g) => g.classes.map((cl) => cl.slug))));
    expect(MODELS.filter((m) => !classSlugs.has(m.cls)).map((m) => m.slug)).toEqual([]);
  });
});

describe("offerModelKey", () => {
  it("prefers the catalog model, then the raw spelling, then nothing", () => {
    expect(offerModelKey("01ABC", "hr2470")).toBe("m:01ABC");
    expect(offerModelKey(null, "hr2470")).toBe("r:hr2470");
    expect(offerModelKey(null, null)).toBe("");
  });
});
