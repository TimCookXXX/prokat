import { describe, it, expect } from "vitest";
import {
  activeFilterCount, emptyParams, localToday, modelPath, parseResultParams, patchParams, pickRangeDay,
  resultHref, resultQuery,
} from "@/lib/compare/scenario";
import { CITY_GEO } from "@/lib/compare/geo-data";

const TODAY = "2026-09-23";
const geo = CITY_GEO[0];
const parse = (sp: Record<string, string>) => parseResultParams(sp, TODAY, geo);

describe("parseResultParams", () => {
  // ТЗ, п. 3.2: без дат — с сегодняшнего дня на 1 сутки, с пометкой.
  it("no dates — today for one day, marked as not given", () => {
    expect(parse({})).toMatchObject({
      classSlug: null, brandSlug: null, from: TODAY, to: "2026-09-24", days: 1, datesGiven: false,
      loc: { kind: "city" }, tab: null,
      filters: { noMoneyDeposit: false, claimed: false, oneDay: false, openToday: false, models: [], okrugs: [] },
    });
  });

  it("reads every parameter", () => {
    const p = parse({
      c: "perforator-sds-max", brand: "makita", model: "makita-hr2470,bosch-gbh-2-26", from: "2026-09-26", to: "2026-09-28",
      loc: "d:yubileynyy", tab: "nearest", nodep: "1", claimed: "1", min1: "1", open: "1", okrug: "zapadnyy,karasunskiy",
    });
    expect(p).toMatchObject({
      classSlug: "perforator-sds-max", brandSlug: "makita", days: 2, datesGiven: true,
      loc: { kind: "microdistrict", microdistrict: "yubileynyy" }, tab: "nearest",
      filters: { noMoneyDeposit: true, claimed: true, oneDay: true, openToday: true, models: ["makita-hr2470", "bosch-gbh-2-26"], okrugs: ["zapadnyy", "karasunskiy"] },
    });
  });

  it("repairs bad values instead of failing", () => {
    expect(parse({ from: "2026-02-30" }).datesGiven).toBe(false);
    expect(parse({ from: "2026-09-01" }).from).toBe(TODAY); // прошлое
    expect(parse({ from: "2026-09-26", to: "2026-09-20" }).to).toBe("2026-09-27");
    expect(parse({ from: "2026-09-26", to: "2027-09-26" }).days).toBe(90);
    expect(parse({ tab: "hack", c: "../x", loc: "d:nowhere" })).toMatchObject({ tab: null, classSlug: null, loc: { kind: "city" } });
  });
});

describe("resultQuery / resultHref", () => {
  it("round-trips through the URL", () => {
    const p = parse({ c: "x", brand: "makita", model: "a,b", from: "2026-09-26", to: "2026-09-28", loc: "p:45.06210,38.95200", la: "ул. Северная, 15", nodep: "1", okrug: "zapadnyy" });
    expect(parse(Object.fromEntries(new URLSearchParams(resultQuery(p))))).toEqual(p);
  });

  it("omits defaults: no dates, city, default tab", () => {
    expect(resultHref("/krasnodar/prokat-perforatora", emptyParams(TODAY))).toBe("/krasnodar/prokat-perforatora");
  });

  it("patching dates marks them as given; filters merge", () => {
    const p = patchParams(parse({ nodep: "1" }), { to: "2026-10-01", filters: { claimed: true } });
    expect(p).toMatchObject({ datesGiven: true, days: 8 });
    expect(activeFilterCount(p.filters)).toBe(2);
  });

  it("model page path uses the group's seo word", () => {
    expect(modelPath("krasnodar", "prokat", "karcher-puzzi-8-1")).toBe("/krasnodar/prokat-karcher-puzzi-8-1");
  });
});

describe("pickRangeDay", () => {
  it("first click picks one day, second closes the range in either order", () => {
    const one = pickRangeDay({ from: null, to: null }, "2026-09-26");
    expect(one).toEqual({ from: "2026-09-26", to: null });
    expect(pickRangeDay(one, "2026-09-28")).toEqual({ from: "2026-09-26", to: "2026-09-28" });
    expect(pickRangeDay(one, "2026-09-24")).toEqual({ from: "2026-09-24", to: "2026-09-26" });
  });
  it("a click on a finished range starts over; the range is capped", () => {
    expect(pickRangeDay({ from: "2026-09-24", to: "2026-09-25" }, "2026-09-26")).toEqual({ from: "2026-09-26", to: null });
    expect(pickRangeDay({ from: "2026-09-24", to: null }, "2027-06-01").to).toBe("2026-12-23");
  });
});

describe("localToday", () => {
  it("uses Moscow time, not UTC", () => {
    expect(localToday(new Date("2026-09-23T22:30:00Z"))).toBe("2026-09-24");
  });
});
