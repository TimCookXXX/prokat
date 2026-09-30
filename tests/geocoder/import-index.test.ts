// Загрузка данных своего геокодера из БД (src/server/geocoder-index.ts): строки таблиц → GeoIndexData,
// кэш процесса и перезагрузка по версии импорта, запасной JSON-файл.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type HouseRow = import("@/server/geocoder-index").HouseRow;

interface FakeDb {
  version: string | null;
  builtAt: string;
  houses: HouseRow[];
  calls: string[];
}

const db: FakeDb = { version: "osm-2026-09-27+gar-2026-09-28", builtAt: "2026-09-30T10:00:00Z", houses: [], calls: [] };

// Пул-заглушка: отвечает по тексту запроса — как настоящие запросы loadGeoIndexFromDb.
const fakePool = {
  query: async (q: string | { text: string }, _values?: unknown[]) => {
    const text = typeof q === "string" ? q : q.text;
    db.calls.push(text.replace(/\s+/g, " ").trim().slice(0, 40));
    if (text.includes("from geo_imports")) {
      return { rows: db.version ? [{ version: db.version, built_at: db.builtAt }] : [] };
    }
    if (text.includes("from cities")) return { rows: [{ id: "city1" }] };
    if (text.includes("from geo_places")) {
      return {
        rows: [
          ["p_krd", "city", "Краснодар", ["г. Краснодар"], null, 45.035, 38.977],
          ["p_jmr", "microdistrict", "Юбилейный", ["ЮМР"], "p_zap", 45.031, 38.912],
          ["p_yab", "town", "Яблоновский", null, null, 45.009, 38.941],
        ],
      };
    }
    if (text.includes("from geo_streets")) {
      return { rows: [["s_bz", "p_yab", "улица Базовская", "улица", ["Базовская улица"], 45.0057, 38.9322, 9]] };
    }
    if (text.includes("from geo_houses")) return { rows: db.houses };
    if (text.includes("from geo_pois")) {
      return { rows: [["o_tc", "ТЦ Красная Площадь", "mall", ["Красная Площадь"], "p_krd", 45.02, 39.03, null]] };
    }
    throw new Error(`unexpected query: ${text}`);
  },
};

// Загрузка берёт своё соединение (pool.connect) и закрывает его: release(true).
const released: boolean[] = [];
const fakePoolWithConnect = {
  ...fakePool,
  connect: async () => ({ query: fakePool.query, release: (destroy?: boolean) => { released.push(!!destroy); } }),
};

vi.mock("@/lib/db", () => ({ getPool: () => fakePoolWithConnect }));

const mod = await import("@/server/geocoder-index");

beforeEach(() => {
  mod.resetGeoIndexCache();
  db.version = "osm-2026-09-27+gar-2026-09-28";
  db.builtAt = "2026-09-30T10:00:00Z";
  db.houses = [
    ["s_bz", "p_yab", "21к1", 45.0106, 38.9363, "house", "osm+gar", "385140"],
    ["s_bz", "p_yab", "21к2", 45.0106, 38.9363, "interpolated", "gar", null],
    [null, "p_snt", "615", 45.1, 39.0, "place", "gar", null],
  ];
  db.calls = [];
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.GEOCODER_INDEX_FILE;
});

describe("rowsToGeoIndex", () => {
  it("maps table rows to the GeoIndexData contract", () => {
    const places: import("@/server/geocoder-index").PlaceRow[] = [
      ["p_jmr", "microdistrict", "Юбилейный", ["ЮМР", "Юбилейка"], "p_zap", 45.031, 38.912],
    ];
    const streets: import("@/server/geocoder-index").StreetRow[] = [
      ["s_1", null, "улица Красная", "улица", null, 45.03, 38.97, 553],
      ["s_2", "p_krd", "улица Ставропольская", "улица", ["ул. Ставропольская"], 45.02, 38.99, 800,
        [[[38.98, 45.01], [38.99, 45.02]], [[39.0, 45.03], [39.01, 45.04]]]],
      ["s_3", "p_krd", "улица Новая", "улица", null, 45.0, 39.0, 3, null],
    ];
    const houses: HouseRow[] = [
      ["s_1", "p_krd", "15", 45.018, 38.968, "interpolated", "gar", null],
      [null, "p_snt", "615", 45.1, 39.0, "place", "gar", "350000"],
    ];
    const pois: import("@/server/geocoder-index").PoiRow[] = [
      ["o_1", "ЖК Панорама", "residential_complex", null, null, 45.0, 39.0, "улица Стасова, 10"],
    ];
    const data = mod.rowsToGeoIndex(
      { version: "v1", citySlug: "krasnodar", builtAt: "2026-09-30T10:00:00Z" }, places, streets, houses, pois,
    );
    expect(data).toMatchObject({ version: "v1", citySlug: "krasnodar", builtAt: "2026-09-30T10:00:00Z" });
    expect(data.places[0]).toEqual({
      id: "p_jmr", kind: "microdistrict", name: "Юбилейный", aliases: ["ЮМР", "Юбилейка"],
      parentId: "p_zap", lat: 45.031, lon: 38.912,
    });
    // NULL в массиве синонимов → пустой список; число домов — поле houses
    expect(data.streets[0]).toEqual({
      id: "s_1", placeId: null, name: "улица Красная", type: "улица", aliases: [], lat: 45.03, lon: 38.97, houses: 553,
    });
    // линия улицы (для обратного геокодирования) — куски [lon, lat]; NULL — поля нет
    expect(data.streets[1].line).toEqual([[[38.98, 45.01], [38.99, 45.02]], [[39.0, 45.03], [39.01, 45.04]]]);
    expect(data.streets[2]).not.toHaveProperty("line");
    // индекс без значения не попадает в объект; дом без улицы — адрес по месту (СНТ)
    expect(data.houses[0]).toEqual({
      streetId: "s_1", placeId: "p_krd", number: "15", lat: 45.018, lon: 38.968, precision: "interpolated", source: "gar",
    });
    expect(data.houses[1]).toMatchObject({ streetId: null, placeId: "p_snt", precision: "place", postcode: "350000" });
    expect(data.pois?.[0]).toMatchObject({ kind: "residential_complex", aliases: [], address: "улица Стасова, 10" });
  });
});

describe("getGeoIndexData", () => {
  it("loads from the tables once and serves the cached copy within a minute", async () => {
    const a = await mod.getGeoIndexData("krasnodar");
    expect(a?.version).toBe("osm-2026-09-27+gar-2026-09-28");
    expect(a?.houses).toHaveLength(3);
    expect(a?.streets[0].name).toBe("улица Базовская");
    const loads = db.calls.filter((c) => c.includes("geo_houses")).length;
    const b = await mod.getGeoIndexData("krasnodar");
    expect(b).toBe(a);
    expect(db.calls.filter((c) => c.includes("geo_houses")).length).toBe(loads);
  });

  it("loads over its own connection and closes it (pg keeps the last result while a connection lives)", async () => {
    released.length = 0;
    await mod.getGeoIndexData("krasnodar");
    expect(released).toEqual([true]);
  });

  it("reloads after a new import (version check at most once a minute)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    const a = await mod.getGeoIndexData("krasnodar");

    // та же версия через минуту — данные не перечитываются
    vi.setSystemTime(new Date("2026-09-30T12:01:30Z"));
    const same = await mod.getGeoIndexData("krasnodar");
    await Promise.resolve();
    expect(same).toBe(a);
    expect(await mod.getGeoIndexData("krasnodar")).toBe(a);

    // новый импорт: пока грузится — прежние данные, затем новые
    db.version = "osm-2026-10-27+gar-2026-10-26";
    db.houses = [["s_bz", "p_yab", "21к1", 45.0106, 38.9363, "house", "osm+gar", null]];
    vi.setSystemTime(new Date("2026-09-30T12:03:00Z"));
    const stale = await mod.getGeoIndexData("krasnodar");
    expect(stale).toBe(a);
    await vi.waitFor(async () => {
      const fresh = await mod.getGeoIndexData("krasnodar");
      expect(fresh?.version).toBe("osm-2026-10-27+gar-2026-10-26");
      expect(fresh?.houses).toHaveLength(1);
    });
  });

  it("returns null without an import and no fallback file", async () => {
    db.version = null;
    expect(await mod.getGeoIndexData("krasnodar")).toBeNull();
  });

  it("falls back to the JSON file when the tables are empty", async () => {
    db.version = null;
    const dir = await mkdtemp(join(tmpdir(), "geo-"));
    const file = join(dir, "index.krasnodar.json");
    await writeFile(file, JSON.stringify({
      version: "file-1", citySlug: "krasnodar", builtAt: "2026-09-30T00:00:00Z",
      places: [], streets: [], houses: [], pois: [],
    }));
    process.env.GEOCODER_INDEX_FILE = file;
    try {
      expect((await mod.getGeoIndexData("krasnodar"))?.version).toBe("file-1");
      mod.resetGeoIndexCache();
      expect(await mod.getGeoIndexData("sochi")).toBeNull();   // файл другого города не подходит
      await writeFile(file, JSON.stringify({ version: "x" }));
      await expect(mod.loadGeoIndexFile(file)).rejects.toThrow(/malformed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
