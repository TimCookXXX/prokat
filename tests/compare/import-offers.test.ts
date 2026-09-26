import { describe, expect, it } from "vitest";
import { findMicrodistrict } from "@/server/compare/import-offers";
import { CITY_GEO } from "@/lib/compare/geo-data";

const list = CITY_GEO[0].microdistricts.map((m) => ({ ...m, kind: "microdistrict" as const }));

describe("findMicrodistrict", () => {
  it("matches by abbreviation, name, slug and with «мкр» in front", () => {
    for (const v of ["ФМР", "фмр", "Фестивальный", "festivalnyy", "мкр Фестивальный", "микрорайон ФМР", "Фестивалка"]) {
      expect(findMicrodistrict(v, list)?.slug, v).toBe("festivalnyy");
    }
  });

  it("returns null for an unknown place", () => {
    expect(findMicrodistrict("Нарния", list)).toBeNull();
  });
});
