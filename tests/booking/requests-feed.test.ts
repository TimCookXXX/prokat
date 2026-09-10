// @vitest-environment node
import { describe, it, expect } from "vitest";
import { toFeedRow, sortFeedRows } from "@/server/requests-feed";
import type { CabinetRequestRow } from "@/server/cabinet";

const TODAY = "2026-09-10";

const row = (over: Partial<CabinetRequestRow> = {}): CabinetRequestRow => ({
  id: "01REQ",
  side: "owner",
  status: "new",
  dateFrom: "2026-09-12",
  dateTo: "2026-09-14",
  qty: 1,
  createdAt: new Date("2026-09-09T10:00:00Z"),
  expiresAt: new Date("2026-09-10T10:00:00Z"),
  ownerComment: null,
  customerComment: null,
  listing: {
    id: "01L", title: "Мангал", slug: "mangal", citySlug: "krasnodar",
    categorySlug: "grili", status: "active", ownerBannedAt: null,
    image: null, priceDay: 300,
  },
  threadId: null,
  peer: { id: "01P", name: "Иван" },
  peerPhone: null,
  ...over,
});

describe("toFeedRow", () => {
  // Диапазон включает обе границы: 12–14 сентября — трое суток.
  it("считает стоимость по включительным суткам", () => {
    expect(toFeedRow(row(), TODAY).estimate).toBe(300 * 3);
    expect(toFeedRow(row({ qty: 2 }), TODAY).estimate).toBe(300 * 3 * 2);
  });

  it("горит только новая заявка владельцу", () => {
    expect(toFeedRow(row(), TODAY).hot).toBe(true);
    expect(toFeedRow(row({ side: "customer" }), TODAY).hot).toBe(false);
    expect(toFeedRow(row({ status: "confirmed" }), TODAY).hot).toBe(false);
  });

  // «Пора отметить» — только владельцу: отметить итог может он один.
  it("просроченная подтверждённая — overdue, но не у арендатора", () => {
    const past = { status: "confirmed" as const, dateFrom: "2026-09-01", dateTo: "2026-09-05" };
    expect(toFeedRow(row(past), TODAY).overdue).toBe(true);
    expect(toFeedRow(row({ ...past, side: "customer" }), TODAY).overdue).toBe(false);
  });

  /* Срок есть у каждого живого статуса. У новой — таймер протухания (его
   * рисует клиент), у подтверждённой — до начала или «идёт», у закрытых и
   * просроченных срока нет: первым всё позади, о вторых говорит бейдж. */
  it("подтверждённой до начала — «старт: N дн.» — что наступит, названо", () => {
    const c = { status: "confirmed" as const };
    expect(toFeedRow(row({ ...c, dateFrom: "2026-09-11", dateTo: "2026-09-12" }), TODAY).deadline)
      .toBe("старт: 1 дн.");
    expect(toFeedRow(row({ ...c, dateFrom: "2026-09-15", dateTo: "2026-09-16" }), TODAY).deadline)
      .toBe("старт: 5 дн.");
  });

  it("идущая подтверждённая — «идёт», просроченная и закрытые — без срока", () => {
    const c = { status: "confirmed" as const };
    expect(toFeedRow(row({ ...c, dateFrom: "2026-09-09", dateTo: "2026-09-12" }), TODAY).deadline)
      .toBe("идёт");
    expect(toFeedRow(row({ ...c, dateFrom: "2026-09-01", dateTo: "2026-09-05" }), TODAY).deadline)
      .toBeNull();
    expect(toFeedRow(row({ status: "declined" }), TODAY).deadline).toBeNull();
  });
});

describe("sortFeedRows", () => {
  it("требующее действия — выше идущего, закрытые позади", () => {
    const rows = [
      toFeedRow(row({ id: "closed", status: "declined" }), TODAY),
      toFeedRow(row({ id: "running", status: "confirmed" }), TODAY),
      toFeedRow(row({ id: "hot" }), TODAY),
    ];
    expect(sortFeedRows(rows).map((r) => r.id)).toEqual(["hot", "running", "closed"]);
  });
});
