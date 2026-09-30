// @vitest-environment node
// Свой геокодер на сайте (src/server/geocoder.ts и /api/geo/*): подсказки сразу с координатами,
// обратный геокодер, мини-индекс с ETag, адреса прокатов для CSV-импорта. Данные — маленькая
// фикстура (tests/geocoder/fixture.ts) вместо таблиц geo_*.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FIXTURE } from "../geocoder/fixture";
import type { GeoIndexData } from "@/lib/geocoder/types";
import { createGeocoder } from "@/lib/geocoder";

// Копия: сервер отпускает дома из данных после сборки движка (data.houses = []).
const fresh = (over: Partial<GeoIndexData> = {}): GeoIndexData => ({ ...FIXTURE, houses: [...FIXTURE.houses], ...over });
const state: { data: GeoIndexData | null; loads: number } = { data: fresh(), loads: 0 };

vi.mock("@/lib/db", () => ({ getPool: () => ({}) }));
vi.mock("@/server/geocoder-index", () => ({
  getGeoIndexData: async (city: string) => {
    state.loads++;
    return city === "krasnodar" ? state.data : null;
  },
  getGeoIndexVersion: async (_pool: unknown, city: string) =>
    city === "krasnodar" && state.data ? { version: state.data.version, builtAt: state.data.builtAt } : null,
}));

const geocoder = await import("@/server/geocoder");
const suggestRoute = await import("@/app/api/geo/suggest/route");
const reverseRoute = await import("@/app/api/geo/reverse/route");
const clientIndexRoute = await import("@/app/api/geo/client-index/route");
const resolveRoute = await import("@/app/api/geo/resolve/route");
const { _resetForTests: resetLimits } = await import("@/lib/rate-limit");

const req = (path: string, headers: Record<string, string> = {}) => new NextRequest(`http://localhost${path}`, { headers });

beforeEach(() => {
  state.data = fresh();
  geocoder.resetGeocoderEngines();
  resetLimits();
});

describe("server geocoder", () => {
  it("suggests houses with coordinates and precision in one call", async () => {
    const [first] = await geocoder.suggestAddresses("красная 120", "krasnodar");
    expect(first).toMatchObject({ kind: "house", title: "улица Красная, 120", precision: "house" });
    expect(first.lat).toBeCloseTo(45.0348, 3);
    expect(first.lon).toBeCloseTo(39.005, 3);
  });

  it("understands typos and the wrong keyboard layout", async () => {
    expect((await geocoder.suggestAddresses("базовкая 21к1", "krasnodar"))[0]?.subtitle).toMatch(/Яблоновский/);
    expect((await geocoder.suggestAddresses(",fpjdcrfz 21", "krasnodar")).map((h) => h.title)).toContain("улица Базовская, 21");
  });

  it("answers nothing for an unknown city or a one-letter query", async () => {
    expect(await geocoder.suggestAddresses("красная", "moskva")).toEqual([]);
    expect(await geocoder.suggestAddresses("к", "krasnodar")).toEqual([]);
  });

  it("keeps one engine per data version and rebuilds when the data changes", async () => {
    const a = await geocoder.getCityGeocoder("krasnodar");
    expect(await geocoder.getCityGeocoder("krasnodar")).toBe(a);
    state.data = fresh({ builtAt: "2026-10-01T00:00:00Z" });
    const b = await geocoder.getCityGeocoder("krasnodar");
    expect(b).not.toBe(a);
    expect(b!.token).not.toBe(a!.token);
  });

  it("releases house objects after the build but still finds houses", async () => {
    const data = state.data!;
    await geocoder.getCityGeocoder("krasnodar");
    expect(data.houses).toEqual([]);
    expect((await geocoder.suggestAddresses("чукотская 23к2", "krasnodar"))[0]?.title).toBe("улица Чукотская, 23к2");
  });

  it("reverse-geocodes a point next to a house", async () => {
    const h = FIXTURE.houses.find((x) => x.number === "120")!;
    const hit = await geocoder.reverseGeocode({ lat: h.lat + 0.0001, lon: h.lon }, "krasnodar");
    expect(hit).toMatchObject({ kind: "house", title: "улица Красная, 120" });
  });

  it("gives the page a data token only when addresses exist", async () => {
    expect(await geocoder.addressIndexToken("krasnodar")).toBe(geocoder.dataToken(FIXTURE));
    expect(await geocoder.addressIndexToken("moskva")).toBeNull();
  });
});

describe("geocodeShopAddress (CSV import)", () => {
  const g = createGeocoder(FIXTURE);

  it("finds a house and returns its point", () => {
    const r = geocodeShop("г. Краснодар, ул. Ставропольская, 104");
    expect(r.point).not.toBeNull();
    if (r.point) expect(r).toMatchObject({ check: null, found: expect.stringContaining("Ставропольская, 104") });
  });

  it("an address present in several places is looked up in the shop's city", () => {
    // «Вишнёвая, 5» — в Краснодаре и в СНТ Кубаночка: пункт не назван — город проката.
    const r = geocodeShop("Вишнёвая, 5");
    expect(r.point).not.toBeNull();
    if (r.point) expect(r.point.lat).toBeCloseTo(45.1, 2);
  });

  it("ambiguous outside the shop's city — no point, the reason lists the variants", () => {
    // «Садовая, 3» — в Яблоновском и в Новой Адыгее, в Краснодаре её нет.
    const r = geocodeShop("Садовая, 3");
    expect(r.point).toBeNull();
    if (!r.point) expect(r.reason).toMatch(/уточните пункт[\s\S]*Яблоновский[\s\S]*Новая Адыгея|уточните пункт[\s\S]*Новая Адыгея[\s\S]*Яблоновский/);
  });

  it("a named settlement wins over the shop's city", () => {
    const r = geocodeShop("пгт Яблоновский, ул. Базовская, 21к1");
    expect(r.point).not.toBeNull();
    if (r.point) expect(r.found).toMatch(/Яблоновский/);
  });

  it("a house number missing from the address base is not stored as a point: «до улицы»", () => {
    // 106 нет в данных, есть 104 и 108: точка по соседям — оценка движка, а не дом
    const r = geocodeShop("Краснодар, Ставропольская, 106");
    expect(r.point).toBeNull();
    if (!r.point) {
      expect(r.reason).toMatch(/^до улицы: такого номера нет/);
      expect(r.found).toContain("≈106");
    }
  });

  it("a house whose point in the base is only approximate is not stored as a point", () => {
    const data = {
      ...FIXTURE,
      streets: [...FIXTURE.streets, { id: "s-sev", placeId: "p-krd", name: "улица Северная", type: "улица", aliases: [], lat: 45.06, lon: 38.97, houses: 4 }],
      houses: [
        ...FIXTURE.houses,
        ...["2", "4", "8"].map((number, i) => ({
          streetId: "s-sev", placeId: "p-krd", number, lat: 45.06, lon: 38.97 + i * 0.0005, precision: "house" as const, source: "osm" as const,
        })),
        { streetId: "s-sev", placeId: "p-krd", number: "6", lat: 45.06, lon: 38.97, precision: "street" as const, source: "gar" as const },
      ],
    };
    const r = geocoder.geocodeShopAddress(createGeocoder(data), "Краснодар, Северная, 6", "Краснодар");
    expect(r.point).toBeNull();
    if (!r.point) expect(r.reason).toMatch(/^до улицы: дом есть в адресном реестре/);
  });

  it("found outside the city without naming the place — stored, but flagged", () => {
    const r = geocodeShop("Садовая, 5"); // только в Яблоновском
    expect(r.point).not.toBeNull();
    if (r.point) expect(r.check).toMatch(/Яблоновский/);
  });

  it("a street without a house is not stored as a point, with a reason", () => {
    const r = geocodeShop("улица Чукотская");
    expect(r.point).toBeNull();
    if (!r.point) expect(r.reason).toMatch(/только улица|уточните/);
  });

  it("an unknown address is reported as not found", () => {
    const r = geocodeShop("улица Несуществующая Первая, 1");
    expect(r.point).toBeNull();
  });

  function geocodeShop(address: string) {
    return geocoder.geocodeShopAddress(g, address, "Краснодар");
  }
});

describe("/api/geo/suggest", () => {
  it("returns hits with coordinates", async () => {
    const res = await suggestRoute.GET(req("/api/geo/suggest?city=krasnodar&q=%D0%BA%D1%80%D0%B0%D1%81%D0%BD%D0%B0%D1%8F%20120"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age");
    const { items } = await res.json();
    expect(items[0]).toMatchObject({ title: "улица Красная, 120", precision: "house" });
    expect(typeof items[0].lat).toBe("number");
  });

  it("rejects a bad city and limits the request rate", async () => {
    expect((await suggestRoute.GET(req("/api/geo/suggest?city=%3Cx%3E&q=abc"))).status).toBe(400);
    let last = 200;
    for (let i = 0; i < 301; i++) last = (await suggestRoute.GET(req("/api/geo/suggest?q=kr", { "x-forwarded-for": "1.2.3.4" }))).status;
    expect(last).toBe(429);
  });

  it("uses near to rank namesakes", async () => {
    const res = await suggestRoute.GET(req(`/api/geo/suggest?q=${encodeURIComponent("вишнёвая 5")}&near=45.13,39.05`));
    const { items } = await res.json();
    expect(items[0].subtitle).toMatch(/Кубаночка/);
  });
});

describe("/api/geo/reverse", () => {
  it("validates the point", async () => {
    expect((await reverseRoute.GET(req("/api/geo/reverse?lat=abc&lon=1"))).status).toBe(400);
    expect((await reverseRoute.GET(req("/api/geo/reverse?lat=95&lon=1"))).status).toBe(400);
  });

  it("returns the nearest address", async () => {
    const h = FIXTURE.houses.find((x) => x.number === "21к1")!;
    const res = await reverseRoute.GET(req(`/api/geo/reverse?lat=${h.lat}&lon=${h.lon}`));
    expect((await res.json()).hit).toMatchObject({ kind: "house", title: "улица Базовская, 21к1" });
  });
});

describe("/api/geo/client-index", () => {
  it("serves the mini index with an ETag and 304 on revalidation", async () => {
    const token = geocoder.dataToken(FIXTURE);
    const res = await clientIndexRoute.GET(req(`/api/geo/client-index?city=krasnodar&v=${token}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe(`"${token}"`);
    expect(res.headers.get("cache-control")).toContain("immutable");
    const body = await res.json();
    expect(body.streets.length).toBe(FIXTURE.streets.length);
    expect(JSON.stringify(body)).not.toContain("21к1"); // без домов
    // выборка производной от OSM базы раздаётся по ODbL: лицензия и источники — в самих данных
    expect(body.license).toMatch(/^ODbL-1\.0/);
    expect(body.attribution).toContain("OpenStreetMap");
    expect(body.attribution).toContain("ГАР ФНС");
    expect(res.headers.get("link")).toContain('rel="license"');

    const again = await clientIndexRoute.GET(req("/api/geo/client-index?city=krasnodar", { "if-none-match": `"${token}"` }));
    expect(again.status).toBe(304);
    expect(again.headers.get("cache-control")).not.toContain("immutable");
  });

  it("404 when the city has no addresses", async () => {
    expect((await clientIndexRoute.GET(req("/api/geo/client-index?city=moskva"))).status).toBe(404);
  });
});

describe("/api/geo/resolve (old tabs)", () => {
  it("finds the point of an old suggestion by its text, ignoring the Yandex uri", async () => {
    const res = await resolveRoute.GET(req(`/api/geo/resolve?uri=ymapsbm1%3A%2F%2Fgeo&title=${encodeURIComponent("Базовская улица, 21к1")}&subtitle=${encodeURIComponent("посёлок городского типа Яблоновский, Тахтамукайский район")}`));
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.point.lat).toBeCloseTo(45.0105, 2);
  });

  it("not_found for an unknown address", async () => {
    const res = await resolveRoute.GET(req(`/api/geo/resolve?title=${encodeURIComponent("Абвгдейкина улица, 999")}`));
    expect((await res.json()).status).toBe("not_found");
  });
});
