import { describe, expect, it } from "vitest";
import {
  haversineKm, locationLabel, locationQuery, matchPlaces, nearestMicrodistrict, okrugOfPoint, parseLocation,
  shopPoint, tripBetween, tripLabel, userOkrug, userPoint, type CityGeo,
} from "@/lib/compare/geo";
import { CITY_GEO } from "@/lib/compare/geo-data";

const geo: CityGeo = CITY_GEO[0];

describe("distance and travel time", () => {
  it("haversine: ЮМР → ФМР is about 4 km in a straight line", () => {
    const ymr = geo.microdistricts.find((m) => m.slug === "yubileynyy")!;
    const fmr = geo.microdistricts.find((m) => m.slug === "festivalnyy")!;
    expect(haversineKm(ymr, fmr)).toBeGreaterThan(3);
    expect(haversineKm(ymr, fmr)).toBeLessThan(5);
  });

  it("route = straight × 1.3, time at 25 km/h", () => {
    const a = { lat: 45, lon: 39 };
    const b = { lat: 45.09, lon: 39 }; // ≈ 10 км по прямой
    const t = tripBetween(a, b, false);
    expect(t.km).toBeCloseTo(13, 0);
    expect(t.minutes).toBe(Math.round((t.km / 25) * 60));
    expect(tripLabel(t)).toMatch(/^13(,\d)? км · ~\d+ мин$/);
    expect(tripLabel({ ...t, approx: true })).toBe(`≈ 13 км · ~${t.minutes} мин`);
  });
});

describe("okrugs and microdistricts", () => {
  it("every microdistrict centre lies in its okrug", () => {
    for (const m of geo.microdistricts) expect(okrugOfPoint(m), m.slug).toBe(m.okrug);
  });

  it("a point outside the city has no okrug", () => {
    expect(okrugOfPoint({ lat: 44.7, lon: 37.8 })).toBeNull(); // Новороссийск
  });

  it("nearest microdistrict within reach, else none", () => {
    expect(nearestMicrodistrict({ lat: 45.0625, lon: 38.953 }, geo)?.slug).toBe("festivalnyy");
    expect(nearestMicrodistrict({ lat: 44.7, lon: 37.8 }, geo)).toBeNull();
  });
});

describe("user and shop points", () => {
  it("city and okrug have no point; microdistrict is approximate; address is exact", () => {
    expect(userPoint({ kind: "city" }, geo)).toBeNull();
    expect(userPoint({ kind: "okrug", okrug: "zapadnyy" }, geo)).toBeNull();
    expect(userPoint({ kind: "microdistrict", microdistrict: "yubileynyy" }, geo)?.approx).toBe(true);
    expect(userPoint({ kind: "point", point: { lat: 45, lon: 39 }, label: null, source: "geo" }, geo)?.approx).toBe(false);
  });

  it("shop: address coordinates → microdistrict centre → unknown", () => {
    expect(shopPoint({ lat: 45.01, lon: 39.02, microdistrict: "yubileynyy" }, geo)).toEqual({ point: { lat: 45.01, lon: 39.02 }, approx: false });
    expect(shopPoint({ lat: null, lon: null, microdistrict: "yubileynyy" }, geo)?.approx).toBe(true);
    expect(shopPoint({ lat: null, lon: null, microdistrict: null }, geo)).toBeNull();
  });

  it("user okrug from microdistrict and from a point", () => {
    expect(userOkrug({ kind: "microdistrict", microdistrict: "festivalnyy" }, geo)).toBe("prikubanskiy");
    expect(userOkrug({ kind: "point", point: { lat: 45.031, lon: 38.9124 }, label: null, source: "address" }, geo)).toBe("zapadnyy");
  });
});

describe("location in the URL", () => {
  it("round-trips every kind", () => {
    const kinds = [
      { kind: "city" as const },
      { kind: "okrug" as const, okrug: "karasunskiy" },
      { kind: "microdistrict" as const, microdistrict: "yubileynyy" },
      { kind: "point" as const, point: { lat: 45.06211, lon: 38.95201 }, label: "ул. Северная, 15", source: "address" as const },
    ];
    for (const loc of kinds) expect(parseLocation(locationQuery(loc), geo)).toEqual(loc);
  });

  it("falls back to the city on garbage", () => {
    for (const loc of ["", "d:nowhere", "o:../x", "p:999,1", "p:abc", "x:yubileynyy"]) {
      expect(parseLocation({ loc }, geo)).toEqual({ kind: "city" });
    }
  });

  it("labels: microdistrict with ≈, okrug by name, city by default", () => {
    expect(locationLabel({ kind: "microdistrict", microdistrict: "yubileynyy" }, geo, "Краснодар")).toBe("Юбилейный ≈");
    expect(locationLabel({ kind: "okrug", okrug: "zapadnyy" }, geo, "Краснодар")).toBe("Западный округ");
    expect(locationLabel({ kind: "city" }, geo, "Краснодар")).toBe("Краснодар");
  });
});

describe("matchPlaces", () => {
  it("«юмр» — Юбилейный first; aliases and wrong layout work", () => {
    expect(matchPlaces("юмр", geo)[0]).toMatchObject({ kind: "microdistrict", slug: "yubileynyy" });
    expect(matchPlaces("Юбилейка", geo)[0].slug).toBe("yubileynyy");
    expect(matchPlaces(".vh", geo)[0].slug).toBe("yubileynyy"); // «юмр» в английской раскладке
    expect(matchPlaces("фмр", geo)[0].slug).toBe("festivalnyy");
  });

  it("okrugs by name", () => {
    expect(matchPlaces("прикуб", geo)[0]).toMatchObject({ kind: "okrug", slug: "prikubanskiy" });
  });

  it("nothing for short or unknown input", () => {
    expect(matchPlaces("ю", geo)).toEqual([]);
    expect(matchPlaces("Нарния", geo)).toEqual([]);
  });
});
