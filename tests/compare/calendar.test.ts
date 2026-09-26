import { describe, expect, it } from "vitest";
import { addMonths, dayState, monthGrid, monthTitle } from "@/lib/compare/calendar";

describe("monthGrid", () => {
  it("starts weeks on Monday and pads with null", () => {
    const g = monthGrid("2026-09"); // 1 сентября 2026 — вторник
    expect(g[0]).toEqual([null, "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
    expect(g.at(-1)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", null, null, null, null]);
  });
  it("handles February of a leap year", () => {
    expect(monthGrid("2028-02").flat().filter(Boolean)).toHaveLength(29);
  });
});

describe("addMonths / monthTitle", () => {
  it("rolls over the year", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthTitle("2026-09")).toBe("Сентябрь 2026");
  });
});

describe("dayState", () => {
  const none = { from: null, to: null };
  it("nothing chosen — nothing drawn", () => {
    expect(dayState("2026-09-24", none, "2026-09-26")).toBe("none");
  });
  it("first day chosen is drawn at once", () => {
    expect(dayState("2026-09-24", { from: "2026-09-24", to: null }, null)).toBe("single");
  });
  it("previews the range to the hovered day in either direction", () => {
    const sel = { from: "2026-09-24", to: null };
    expect(["2026-09-24", "2026-09-25", "2026-09-26"].map((d) => dayState(d, sel, "2026-09-26"))).toEqual(["start", "middle", "end"]);
    expect(["2026-09-22", "2026-09-23", "2026-09-24"].map((d) => dayState(d, sel, "2026-09-22"))).toEqual(["start", "middle", "end"]);
  });
  it("a finished range ignores hover", () => {
    expect(dayState("2026-09-27", { from: "2026-09-24", to: "2026-09-26" }, "2026-09-28")).toBe("none");
  });
});
