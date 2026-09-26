import { afterEach, describe, expect, it, vi } from "vitest";
import { roadRoutes, yandexRouter, type Router } from "@/server/routing";
import { pointKey, tripBetween } from "@/lib/compare/geo";

vi.mock("@/lib/env", () => ({ getEnv: () => ({}) }));

const home = { lat: 45.0106, lon: 38.9367 }; // Яблоновский
const shopA = { lat: 45.028, lon: 38.908 }; // ЮМР, через Кубань
const shopB = { lat: 45.04, lon: 38.976 };

const fake = (name: string, fn: Router["routes"], ttlMs = 60_000): Router => ({ name, ttlMs, routes: fn });

afterEach(() => vi.restoreAllMocks());

describe("tripBetween", () => {
  it("road distance with router time, road distance with average speed, straight line", () => {
    expect(tripBetween(home, shopA, false, { km: 10.4, minutes: 25 })).toEqual({ km: 10.4, minutes: 25, approx: false });
    expect(tripBetween(home, shopA, false, { km: 8.7, minutes: null })).toEqual({ km: 8.7, minutes: 21, approx: false });
    expect(tripBetween(home, shopA, false).km).toBeLessThan(4); // по прямой не видит реку
  });
});

describe("roadRoutes", () => {
  it("asks once per unique point and caches the answer", async () => {
    const calls: number[] = [];
    const r = fake("a", async (_f, to) => { calls.push(to.length); return to.map((p) => ({ km: p === shopA ? 8.7 : 5, minutes: null })); });
    const first = await roadRoutes(home, [shopA, shopB, shopA], [r]);
    expect(first.get(pointKey(shopA))?.km).toBe(8.7);
    expect(calls).toEqual([2]);
    await roadRoutes(home, [shopA, shopB], [r]);
    expect(calls).toEqual([2]);
  });

  it("falls through the chain: points the first router failed are asked from the next", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const from = { lat: 45.1, lon: 39.1 };
    const yandex = fake("yandex", async () => { throw new Error("429"); });
    const osrm = fake("osrm", async (_f, to) => to.map(() => ({ km: 7, minutes: null })));
    expect((await roadRoutes(from, [shopA], [yandex, osrm])).get(pointKey(shopA))).toEqual({ km: 7, minutes: null });
  });

  it("a point without a route at the first router goes to the next one", async () => {
    const from = { lat: 45.2, lon: 39.2 };
    const first = fake("a", async (_f, to) => to.map((p) => (p === shopA ? null : { km: 1, minutes: 3 })));
    const second = fake("b", async (_f, to) => to.map(() => ({ km: 9, minutes: null })));
    const m = await roadRoutes(from, [shopA, shopB], [first, second]);
    expect(m.get(pointKey(shopA))?.km).toBe(9);
    expect(m.get(pointKey(shopB))?.minutes).toBe(3);
  });

  it("everything failed — empty map (straight line), nothing cached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const from = { lat: 45.3, lon: 39.3 };
    let fail = true;
    const r = fake("x", async (_f, to) => { if (fail) throw new Error("down"); return to.map(() => ({ km: 3, minutes: null })); });
    expect((await roadRoutes(from, [shopB], [r])).size).toBe(0);
    fail = false;
    expect((await roadRoutes(from, [shopB], [r])).get(pointKey(shopB))?.km).toBe(3);
    expect((await roadRoutes({ lat: 45.4, lon: 39.4 }, [shopA], [])).size).toBe(0); // нет маршрутизаторов
  });
});

describe("yandexRouter", () => {
  it("sends lat,lon points separated by | and reads meters and seconds with traffic", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      rows: [{ elements: [
        { status: "OK", distance: { value: 10400 }, duration: { value: 1500 } },
        { status: "FAIL" },
      ] }],
    })));
    const out = await yandexRouter("KEY").routes(home, [shopA, shopB]);
    expect(out).toEqual([{ km: 10.4, minutes: 25 }, null]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://api.routing.yandex.net/v2/distancematrix");
    expect(url.searchParams.get("origins")).toBe("45.010600,38.936700");
    expect(url.searchParams.get("destinations")).toBe("45.028000,38.908000|45.040000,38.976000");
    expect(url.searchParams.get("apikey")).toBe("KEY");
    expect(url.searchParams.get("departure_time")).toMatch(/^\d+$/);
  });

  it("splits more than 100 destinations into several requests (matrix limit 100 elements)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const n = new URL(String(input)).searchParams.get("destinations")!.split("|").length;
      return new Response(JSON.stringify({ rows: [{ elements: Array.from({ length: n }, () => ({ status: "OK", distance: { value: 1000 }, duration: { value: 60 } })) }] }));
    });
    const to = Array.from({ length: 150 }, (_, i) => ({ lat: 45 + i / 1000, lon: 39 }));
    expect(await yandexRouter("KEY").routes(home, to)).toHaveLength(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on API errors so the chain falls back", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ errors: ["Counter total limit exceeded"] }), { status: 429 }));
    await expect(yandexRouter("KEY").routes(home, [shopA])).rejects.toThrow(/429.*limit/);
  });
});
