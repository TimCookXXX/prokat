import { describe, it, expect } from "vitest";
import { occupancySummary, type AvailabilityMap } from "@/lib/catalog/availability";

const map = (entries: Record<string, [number, number]>): AvailabilityMap =>
  new Map(Object.entries(entries).map(([d, [booked, blocked]]) => [
    d, { bookedQty: booked, blockedQty: blocked },
  ]));

describe("occupancySummary", () => {
  it("пустое окно — свободно целиком", () => {
    const s = occupancySummary(1, map({}), "2026-09-08", "2026-09-14");
    expect(s).toEqual({ busyDays: 0, nextBusyFrom: null, nextBusyTo: null });
  });

  it("считает занятые дни и первую череду", () => {
    const s = occupancySummary(1, map({
      "2026-09-10": [1, 0],
      "2026-09-11": [1, 0],
      "2026-09-14": [0, 1],
    }), "2026-09-08", "2026-09-14");
    expect(s.busyDays).toBe(3);
    expect(s.nextBusyFrom).toBe("2026-09-10");
    // Череда закрывается первым свободным днём: 14-е в неё не входит.
    expect(s.nextBusyTo).toBe("2026-09-11");
  });

  // Частичная занятость — тоже занятость: у вещи из трёх единиц занята одна,
  // значит день уже не «свободен целиком», и в календаре он выделен.
  it("частично занятый день считается занятым", () => {
    const s = occupancySummary(3, map({ "2026-09-09": [1, 0] }), "2026-09-08", "2026-09-10");
    expect(s.busyDays).toBe(1);
    expect(s.nextBusyFrom).toBe("2026-09-09");
    expect(s.nextBusyTo).toBe("2026-09-09");
  });

  it("ручное закрытие считается наравне с бронью", () => {
    const s = occupancySummary(1, map({ "2026-09-08": [0, 1] }), "2026-09-08", "2026-09-09");
    expect(s.busyDays).toBe(1);
    expect(s.nextBusyFrom).toBe("2026-09-08");
  });

  it("череда, упирающаяся в конец окна, не обрывается раньше времени", () => {
    const s = occupancySummary(1, map({
      "2026-09-13": [1, 0],
      "2026-09-14": [1, 0],
    }), "2026-09-08", "2026-09-14");
    expect(s.nextBusyFrom).toBe("2026-09-13");
    expect(s.nextBusyTo).toBe("2026-09-14");
  });
});
