import { describe, it, expect } from "vitest";
import { CATALOG, CATALOG_CITIES, DEFAULT_CITY_SLUG, SHOPS_SEGMENT } from "@/lib/compare/catalog-data";

const groups = CATALOG.flatMap((c) => c.groups);
const classes = groups.flatMap((g) => g.classes);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("comparison catalog", () => {
  it("has the default city", () => {
    expect(CATALOG_CITIES.map((c) => c.slug)).toContain(DEFAULT_CITY_SLUG);
  });

  it("keeps slugs unique and URL-safe", () => {
    for (const list of [CATALOG.map((c) => c.slug), groups.map((g) => g.slug), classes.map((c) => c.slug)]) {
      expect(new Set(list).size).toBe(list.length);
      for (const s of list) expect(s).toMatch(SLUG);
    }
  });

  // Группы и категории делят сегмент /{city}/{seg}.
  it("does not let a group slug shadow a category or the shops list", () => {
    const categorySlugs = new Set([...CATALOG.map((c) => c.slug), SHOPS_SEGMENT]);
    expect(groups.filter((g) => categorySlugs.has(g.slug))).toEqual([]);
  });

  it("gives every group at least one class", () => {
    expect(groups.filter((g) => g.classes.length === 0)).toEqual([]);
  });

  it("starts with the ten tool groups of the plan", () => {
    expect(CATALOG.find((c) => c.slug === "instrumenty")!.groups).toHaveLength(10);
  });
});
