// Логика поля «Где» со своим геокодером (src/lib/compare/address.ts): подсказка → место с
// координатами и точностью, подписи, порядок ответов сервера при наборе, список без мигания.
import { describe, expect, it } from "vitest";
import {
  hitLabel, hitPrecision, hitToLocation, needsServer, precisionNote, reverseLabel, shouldApply,
  visibleAddresses, withoutPlaceDuplicates, type AddressHit,
} from "@/lib/compare/address";
import { locationQuery, parseLocation, userPoint } from "@/lib/compare/geo";
import { CITY_GEO } from "@/lib/compare/geo-data";

const geo = CITY_GEO[0];

function hit(p: Partial<AddressHit> & Pick<AddressHit, "title">): AddressHit {
  return {
    id: p.title, kind: "house", subtitle: "Краснодар", lat: 45.03, lon: 38.97, precision: "house", score: 100,
    parts: { place: "Краснодар", street: null, house: null }, ...p,
  };
}

const house = hit({ title: "улица Красная, 120" });
const yab = hit({ title: "улица Базовская, 21к1", subtitle: "Яблоновский", parts: { place: "Яблоновский", street: "улица Базовская", house: "21к1" } });
const between = hit({ title: "улица Ставропольская, ≈106", kind: "street", precision: "street" });
const street = hit({ title: "улица Красная", kind: "street", precision: "street" });
const place = hit({ title: "Яблоновский", kind: "place", precision: "place", subtitle: "посёлок", parts: { place: "Яблоновский", street: null, house: null } });

describe("precision of a suggestion", () => {
  it("a house (also interpolated) is exact; a missing number, a street or a place is «≈»", () => {
    expect(hitPrecision(house)).toBeUndefined();
    expect(hitPrecision({ kind: "house", precision: "interpolated" })).toBeUndefined();
    expect(hitPrecision({ kind: "poi", precision: "house" })).toBeUndefined();
    expect(hitPrecision(between)).toBe("street");
    expect(hitPrecision({ kind: "house", precision: "street" })).toBe("street");
    expect(hitPrecision(street)).toBe("street");
    expect(hitPrecision(place)).toBe("place");
    expect(precisionNote("street")).toContain("≈");
    expect(precisionNote(undefined)).toBeNull();
  });
});

describe("labels", () => {
  it("adds the settlement outside the main city", () => {
    expect(hitLabel(house, "Краснодар")).toBe("улица Красная, 120");
    expect(hitLabel(yab, "Краснодар")).toBe("улица Базовская, 21к1, Яблоновский");
    expect(hitLabel(place, "Краснодар")).toBe("Яблоновский");
  });

  it("geolocation: a house — its address, otherwise «рядом»", () => {
    expect(reverseLabel(house, "Краснодар")).toBe("улица Красная, 120");
    expect(reverseLabel(street, "Краснодар")).toBe("рядом: улица Красная");
    expect(reverseLabel(null, "Краснодар")).toBeNull();
  });
});

describe("hit → location → URL", () => {
  it("carries coordinates at once and keeps precision through the URL", () => {
    const loc = hitToLocation(between, "Краснодар");
    expect(loc).toMatchObject({ kind: "point", point: { lat: 45.03, lon: 38.97 }, source: "address", precision: "street" });
    const q = locationQuery(loc);
    expect(q.lp).toBe("s");
    expect(parseLocation(q, geo)).toEqual(loc);
    expect(userPoint(loc, geo)?.approx).toBe(true);
  });

  it("a house has no lp and is exact; old links without lp read as a house", () => {
    const loc = hitToLocation(house, "Краснодар");
    expect(locationQuery(loc).lp).toBeUndefined();
    expect(userPoint(loc, geo)?.approx).toBe(false);
    const old = parseLocation({ loc: "p:45.03,38.97", la: "ул. Красная, 120" }, geo);
    expect(old.kind === "point" && old.precision).toBeFalsy();
    expect(parseLocation({ loc: "p:45.03,38.97", lp: "t" }, geo)).toMatchObject({ precision: "place" });
    expect(parseLocation({ loc: "p:45.03,38.97", lp: "zzz" }, geo)).not.toHaveProperty("precision");
  });
});

describe("server requests while typing", () => {
  it("asks the server for houses only; streets come from the mini index", () => {
    expect(needsServer("красная", true)).toBe(false);
    expect(needsServer("красная 1", true)).toBe(true);
    expect(needsServer("красная", false)).toBe(true);
    expect(needsServer("к", false)).toBe(false);
  });

  it("drops replies older than the shown one and replies to text the user has left", () => {
    expect(shouldApply({ seq: 3, q: "красная 12" }, 2, "красная 12")).toBe(true);
    expect(shouldApply({ seq: 2, q: "красная 1" }, 3, "красная 12")).toBe(false);   // пришёл после более нового
    expect(shouldApply({ seq: 4, q: "красная 1" }, 3, "красная 12")).toBe(true);    // начало набираемого — лучше прошлого
    expect(shouldApply({ seq: 5, q: "красная 12" }, 4, "красная 1")).toBe(false);   // текст уже стёрли
  });
});

describe("visible list does not blink", () => {
  const streets = [street];
  const houses = [house];

  it("the server reply to exactly this text wins", () => {
    expect(visibleAddresses("красная 120", { q: "Красная 120", items: houses }, streets)).toBe(houses);
  });

  it("while a number is typed, previous houses stay instead of falling back to streets", () => {
    expect(visibleAddresses("красная 120", { q: "красная 12", items: houses }, streets)).toBe(houses);
  });

  it("without a number — the mini index at once", () => {
    expect(visibleAddresses("красн", { q: "крас", items: houses }, streets)).toBe(streets);
  });

  it("without the mini index — the previous server list until a new one comes", () => {
    expect(visibleAddresses("красная 1", { q: "красная", items: streets }, null)).toBe(streets);
    expect(visibleAddresses("красная", null, null)).toEqual([]);
  });

  it("does not repeat microdistricts already suggested from the places list", () => {
    const ymr = hit({ title: "Юбилейный", kind: "place", precision: "place" });
    expect(withoutPlaceDuplicates([ymr, house], ["Юбилейный"])).toEqual([house]);
    expect(withoutPlaceDuplicates([ymr, house], [])).toEqual([ymr, house]);
  });
});
