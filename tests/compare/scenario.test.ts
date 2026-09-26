import { describe, it, expect } from "vitest";
import {
  activeFilterCount, compareHref, compareQuery, localToday, parseCompareParams, patchParams, pickRangeDay,
} from "@/lib/compare/scenario";

const TODAY = "2026-09-23";

describe("parseCompareParams", () => {
  it("defaults to tomorrow for one day with delivery", () => {
    const p = parseCompareParams({}, TODAY);
    expect(p).toMatchObject({
      classSlug: null, model: null, from: "2026-09-24", to: "2026-09-25", days: 1, pickup: false,
      tab: "cheapest",
      filters: { noMoneyDeposit: false, sameDay: false, claimed: false, oneDay: false, areas: [] },
    });
  });

  it("reads every parameter", () => {
    const p = parseCompareParams({
      c: "perforator-sds-max", from: "2026-09-26", to: "2026-09-28", pickup: "1", r: "ФМР",
      tab: "sameDay", nodep: "1", today: "1", claimed: "1", min1: "1", area: "ЮМР, ФМР,ЮМР",
    }, TODAY);
    expect(p).toMatchObject({
      classSlug: "perforator-sds-max", days: 2, pickup: true, tab: "sameDay",
      filters: { noMoneyDeposit: true, sameDay: true, claimed: true, oneDay: true, areas: ["ЮМР", "ФМР"] },
    });
  });

  it("repairs bad dates instead of failing", () => {
    expect(parseCompareParams({ from: "2026-02-30" }, TODAY).from).toBe("2026-09-24");
    expect(parseCompareParams({ from: "2026-09-01" }, TODAY).from).toBe("2026-09-24"); // прошлое
    expect(parseCompareParams({ from: "2026-09-26", to: "2026-09-20" }, TODAY).to).toBe("2026-09-27");
    expect(parseCompareParams({ from: "2026-09-26", to: "2027-09-26" }, TODAY).days).toBe(90);
    expect(parseCompareParams({ tab: "hack" }, TODAY).tab).toBe("cheapest");
  });

  it("allows same-day return as one day", () => {
    expect(parseCompareParams({ from: "2026-09-26", to: "2026-09-26" }, TODAY).days).toBe(1);
  });
});

describe("pickRangeDay", () => {
  it("first click picks one day, second closes the range in either order", () => {
    const one = pickRangeDay({ from: null, to: null }, "2026-09-26");
    expect(one).toEqual({ from: "2026-09-26", to: null });
    expect(pickRangeDay(one, "2026-09-28")).toEqual({ from: "2026-09-26", to: "2026-09-28" });
    expect(pickRangeDay(one, "2026-09-24")).toEqual({ from: "2026-09-24", to: "2026-09-26" });
    expect(pickRangeDay(one, "2026-09-26")).toEqual({ from: "2026-09-26", to: "2026-09-26" });
  });

  it("a click on a finished range starts over", () => {
    expect(pickRangeDay({ from: "2026-09-24", to: "2026-09-25" }, "2026-09-26")).toEqual({ from: "2026-09-26", to: null });
  });

  it("caps the range at the maximum term", () => {
    expect(pickRangeDay({ from: "2026-09-24", to: null }, "2027-06-01").to).toBe("2026-12-23");
  });
});

describe("compareQuery / compareHref", () => {
  it("round-trips through the URL", () => {
    const p = parseCompareParams({ c: "x", m: "Makita HR2470", from: "2026-09-26", to: "2026-09-28", r: "ФМР", nodep: "1", area: "ЮМР" }, TODAY);
    const again = parseCompareParams(Object.fromEntries(new URLSearchParams(compareQuery(p))), TODAY);
    expect(again).toEqual(p);
  });

  it("omits defaults and ignores the removed district parameter", () => {
    const p = patchParams(parseCompareParams({ r: "ФМР" }, TODAY), { pickup: true });
    expect(compareHref("krasnodar", "prokat-perforatora", p))
      .toBe("/krasnodar/prokat-perforatora?from=2026-09-24&to=2026-09-25&pickup=1");
  });

  it("patches filters without dropping the others", () => {
    const p = parseCompareParams({ nodep: "1" }, TODAY);
    const next = patchParams(p, { filters: { claimed: true }, to: "2026-10-01" });
    expect(next.filters).toMatchObject({ noMoneyDeposit: true, claimed: true });
    expect(next.days).toBe(7);
    expect(activeFilterCount(next.filters)).toBe(2);
  });
});

describe("localToday", () => {
  it("uses Moscow time, not UTC", () => {
    // 22:30 UTC 23 сен = 01:30 24 сен по Москве.
    expect(localToday(new Date("2026-09-23T22:30:00Z"))).toBe("2026-09-24");
  });
});
