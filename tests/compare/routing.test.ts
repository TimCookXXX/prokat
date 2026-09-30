import { afterEach, describe, expect, it, vi } from "vitest";
import { osrmMinutes, osrmRouter, roadRoutes, type Router } from "@/server/routing";
import { pointKey, trafficFactor, tripBetween } from "@/lib/compare/geo";

vi.mock("@/lib/env", () => ({ getEnv: () => ({}) }));

const home = { lat: 45.0106, lon: 38.9367 }; // Яблоновский
const shopA = { lat: 45.028, lon: 38.908 }; // ЮМР, через Кубань
const shopB = { lat: 45.04, lon: 38.976 };

const fake = (name: string, fn: Router["routes"], ttlMs = 60_000): Router => ({ name, ttlMs, routes: fn });

afterEach(() => vi.restoreAllMocks());

describe("tripBetween", () => {
  it("road route or the calibrated straight-line fallback; the card shows the current hour", () => {
    expect(tripBetween(home, shopA, false, { km: 9.7, minutes: 23 })).toEqual({ km: 9.7, minutes: 23, nowMinutes: 23, approx: false });
    expect(tripBetween(home, shopA, false, { km: 9.7, minutes: 23 }, () => 1.15).nowMinutes).toBe(26);
    const straight = tripBetween(home, shopA, false);
    expect(straight.km).toBeLessThan(6); // по прямой не видит реку
    expect(straight.minutes).toBe(Math.round((straight.km / 28.5) * 60 + 5.7));
  });

  it("traffic by weekday, hour and trip length (2GIS hourly curve)", () => {
    const wd = (time: string) => ({ weekday: 2, time });
    expect(trafficFactor(wd("13:00"), 10)).toBeCloseTo(1, 5);
    expect(trafficFactor(wd("08:30"), 15)).toBe(1.08);           // утренний пик, длинная поездка
    expect(trafficFactor(wd("21:14"), 15)).toBe(0.69);           // вечер: у 2ГИС на 20–30% быстрее дня
    expect(trafficFactor(wd("03:00"), 1)).toBeGreaterThan(trafficFactor(wd("03:00"), 20)); // ночью короткие ускоряются меньше
    expect(trafficFactor({ weekday: 6, time: "13:00" }, 15)).toBeLessThan(0.9);          // воскресенье
    expect(trafficFactor(wd("99:99"), 5)).toBeGreaterThan(0);                            // мусор во времени — не падаем
  });
});

describe("roadRoutes", () => {
  it("asks once per unique point and caches the answer", async () => {
    const calls: number[] = [];
    const r = fake("a", async (_f, to) => { calls.push(to.length); return to.map((p) => ({ km: p === shopA ? 8.7 : 5, minutes: 20 })); });
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
    const osrm = fake("osrm", async (_f, to) => to.map(() => ({ km: 7, minutes: 20 })));
    expect((await roadRoutes(from, [shopA], [yandex, osrm])).get(pointKey(shopA))).toEqual({ km: 7, minutes: 20 });
  });

  it("a point without a route at the first router goes to the next one", async () => {
    const from = { lat: 45.2, lon: 39.2 };
    const first = fake("a", async (_f, to) => to.map((p) => (p === shopA ? null : { km: 1, minutes: 3 })));
    const second = fake("b", async (_f, to) => to.map(() => ({ km: 9, minutes: 20 })));
    const m = await roadRoutes(from, [shopA, shopB], [first, second]);
    expect(m.get(pointKey(shopA))?.km).toBe(9);
    expect(m.get(pointKey(shopB))?.minutes).toBe(3);
  });

  it("everything failed — empty map (straight line), nothing cached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const from = { lat: 45.3, lon: 39.3 };
    let fail = true;
    const r = fake("x", async (_f, to) => { if (fail) throw new Error("down"); return to.map(() => ({ km: 3, minutes: 20 })); });
    expect((await roadRoutes(from, [shopB], [r])).size).toBe(0);
    fail = false;
    expect((await roadRoutes(from, [shopB], [r])).get(pointKey(shopB))?.km).toBe(3);
    expect((await roadRoutes({ lat: 45.4, lon: 39.4 }, [shopA], [])).size).toBe(0); // нет маршрутизаторов
  });
});

describe("osrmRouter", () => {
  it("one table row from the user: distance in km and calibrated daytime minutes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: "Ok",
      distances: [[0, 9740, null]],
      durations: [[0, 1360, null]],
    })));
    expect(await osrmRouter("http://osrm:5000/").routes(home, [shopA, shopB])).toEqual([{ km: 9.74, minutes: osrmMinutes(1360) }, null]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/table/v1/driving/38.936700,45.010600;38.908000,45.028000;38.976000,45.040000");
    expect(url.searchParams.get("sources")).toBe("0");
    expect(url.searchParams.get("annotations")).toBe("distance,duration");
  });

  it("calibrated minutes: OSRM seconds plus time to set off and park", () => {
    // Как predict.py (F-final): (1 × с + 48,75) / 60, затем округление и минимум 1 минута.
    expect(osrmMinutes(1320)).toBe(23); // 22,81
    expect(osrmMinutes(600)).toBe(11); // 10,81
    expect(osrmMinutes(62)).toBe(2); // 1,85
    expect(osrmMinutes(0)).toBe(1); // 0,81 → минимум 1
  });

  it("throws on errors so the page falls back to the straight line", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    await expect(osrmRouter("http://osrm:5000").routes(home, [shopA])).rejects.toThrow(/503/);
  });
});
