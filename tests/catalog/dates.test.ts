import { describe, it, expect } from "vitest";
import { formatMonthYearGen, todayStr, formatDayMonthNum,
} from "@/lib/catalog/dates";

describe("todayStr", () => {
  it("takes the calendar day in the business zone, not in UTC", () => {
    // Ночной кейс: в 00:45 МСК в UTC ещё вчера, и день брони уезжал на сутки
    // назад — вчерашняя дата оставалась выбираемой до 03:00. Днём разницы
    // между зонами не видно, поэтому граница проверяется именно ночью.
    expect(todayStr(new Date("2026-09-05T00:45:00+03:00"))).toBe("2026-09-05");
    expect(todayStr(new Date("2026-09-04T23:59:00+03:00"))).toBe("2026-09-04");
  });

  it("does not depend on the zone of the machine running it", () => {
    // Один и тот же инстант, записанный тремя способами: ответ обязан совпасть.
    expect(todayStr(new Date("2026-09-04T21:45:00Z"))).toBe("2026-09-05");
    expect(todayStr(new Date("2026-09-05T04:45:00+07:00"))).toBe("2026-09-05");
  });
});

describe("formatMonthYearGen", () => {
  it("puts the month into the genitive for «на сайте с …»", () => {
    expect(formatMonthYearGen(new Date(Date.UTC(2026, 7, 19)))).toBe("августа 2026");
    expect(formatMonthYearGen(new Date(Date.UTC(2024, 2, 1)))).toBe("марта 2024");
  });

  it("reads the month in the business zone", () => {
    // 31 августа 22:00 UTC = 1 сентября 01:00 МСК: регистрация в эту минуту
    // подписывалась как «на сайте с августа».
    expect(formatMonthYearGen(new Date(Date.UTC(2026, 7, 31, 22, 0)))).toBe("сентября 2026");
    expect(formatMonthYearGen(new Date(Date.UTC(2025, 11, 31, 22, 0)))).toBe("января 2026");
  });
});

/* Цифровой период для колонок: «8 сентября — 14 сентября» в парном виде не
 * влезает никуда. Ведущий ноль обязателен — в колонке даты выравниваются. */
describe("formatDayMonthNum", () => {
  it("день и месяц с ведущими нулями", () => {
    expect(formatDayMonthNum("2026-09-08")).toBe("08.09");
    expect(formatDayMonthNum("2026-12-31")).toBe("31.12");
    expect(formatDayMonthNum("2026-01-01")).toBe("01.01");
  });
});
