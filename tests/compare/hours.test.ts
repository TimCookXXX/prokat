import { describe, expect, it } from "vitest";
import { cityNow, openLabel, openState, parseHours } from "@/lib/compare/hours";

describe("parseHours", () => {
  it("reads day ranges, lists, day-offs and short times", () => {
    expect(parseHours("пн-пт 9:00-20:00; сб,вс 10-16; вс выходной")).toEqual({
      mon: [["09:00", "20:00"]], tue: [["09:00", "20:00"]], wed: [["09:00", "20:00"]],
      thu: [["09:00", "20:00"]], fri: [["09:00", "20:00"]], sat: [["10:00", "16:00"]],
    });
  });

  it("reads «ежедневно» and «круглосуточно»", () => {
    expect(Object.keys(parseHours("ежедневно 9-21")!)).toHaveLength(7);
    expect(parseHours("круглосуточно")!.sun).toEqual([["00:00", "24:00"]]);
  });

  it("reads a lunch break as two intervals", () => {
    expect(parseHours("пн 9-13, 14-18")!.mon).toEqual([["09:00", "13:00"], ["14:00", "18:00"]]);
  });

  it("returns null for empty and throws on nonsense", () => {
    expect(parseHours("  ")).toBeNull();
    expect(() => parseHours("всегда")).toThrow(/пн-пт/);
    expect(() => parseHours("пн 20-9")).toThrow(/интервал/);
  });
});

describe("openState / openLabel", () => {
  const hours = parseHours("пн-пт 9-20; сб 10-16");
  it("open now or later today — until the last closing time", () => {
    expect(openLabel(openState(hours, { weekday: 0, time: "08:00" }))).toBe("Работает сегодня до 20:00");
    expect(openLabel(openState(hours, { weekday: 5, time: "12:30" }))).toBe("Работает сегодня до 16:00");
  });
  it("closed after hours and on days without hours", () => {
    expect(openLabel(openState(hours, { weekday: 0, time: "20:00" }))).toBe("Сегодня закрыто");
    expect(openLabel(openState(hours, { weekday: 6, time: "12:00" }))).toBe("Сегодня закрыто");
  });
  it("unknown hours — no label", () => {
    expect(openLabel(openState(null, { weekday: 0, time: "12:00" }))).toBeNull();
  });
  it("round the clock", () => {
    expect(openLabel(openState(parseHours("круглосуточно"), { weekday: 2, time: "03:00" }))).toBe("Работает круглосуточно");
  });
});

describe("cityNow", () => {
  it("uses Moscow time and Monday as day 0", () => {
    // 2026-09-27 — воскресенье; 21:30 UTC = 00:30 понедельника по Москве.
    expect(cityNow(new Date("2026-09-27T21:30:00Z"))).toEqual({ weekday: 0, time: "00:30" });
  });
});

describe("regressions", () => {
  it("intervals written out of order still give the last closing time", () => {
    expect(openState(parseHours("ежедневно 14-20, 9-13"), { weekday: 0, time: "10:00" })?.until).toBe("20:00");
  });
});
