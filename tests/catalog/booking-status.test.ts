import { describe, it, expect } from "vitest";
import {
  canTransition, isTerminal, holdsAvailability, availabilityDelta,
  type BookingStatus,
} from "@/lib/catalog/booking-status";

const ALL: BookingStatus[] = [
  "new", "confirmed", "declined", "expired", "completed", "cancelled",
];

describe("canTransition()", () => {
  it.each([
    ["new", "confirmed"],
    ["new", "declined"],
    ["new", "expired"],
    ["new", "cancelled"],
    ["confirmed", "completed"],
    ["confirmed", "cancelled"],
  ] as const)("разрешает %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["new", "completed"],     // завершить можно только подтверждённую
    ["confirmed", "declined"],// после подтверждения отклонить нельзя — только отменить
    ["confirmed", "expired"], // протухает только new
    ["declined", "confirmed"],
    ["expired", "confirmed"],
    ["cancelled", "new"],
    ["completed", "cancelled"],
  ] as const)("запрещает %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("самопереходы запрещены", () => {
    for (const s of ALL) expect(canTransition(s, s)).toBe(false);
  });
});

describe("isTerminal()", () => {
  it("терминальны все кроме new и confirmed", () => {
    expect(ALL.filter(isTerminal)).toEqual([
      "declined", "expired", "completed", "cancelled",
    ]);
  });
});

describe("availabilityDelta()", () => {
  it("подтверждение занимает даты (+1)", () => {
    expect(availabilityDelta("new", "confirmed")).toBe(1);
  });

  it("отмена подтверждённой освобождает даты (-1)", () => {
    expect(availabilityDelta("confirmed", "cancelled")).toBe(-1);
  });

  /* Закрытие вовремя календарь не трогает: диапазон прожит, история
   * занятости честная. Досрочный возврат освобождает остаток дат, но это
   * граница по дате, а не знак на всём диапазоне, — она в transitionRequest,
   * и её проверяет tests/booking/owner-cancel.test.ts. */
  it("завершение даты не освобождает (история занятости)", () => {
    expect(availabilityDelta("confirmed", "completed")).toBe(0);
  });

  it("отклонение/протухание new ничего не меняет — даты ещё не заняты", () => {
    expect(availabilityDelta("new", "declined")).toBe(0);
    expect(availabilityDelta("new", "expired")).toBe(0);
    expect(availabilityDelta("new", "cancelled")).toBe(0);
  });

  it("бросает на запрещённом переходе", () => {
    expect(() => availabilityDelta("completed", "cancelled")).toThrow(/illegal transition/);
  });

  it("holdsAvailability: только confirmed держит единицы", () => {
    expect(ALL.filter(holdsAvailability)).toEqual(["confirmed"]);
  });
});
