// @vitest-environment node
import { describe, it, expect } from "vitest";
import { toFeedRow, sortFeedRows } from "@/server/requests-feed";
import type { CabinetRequestRow } from "@/server/cabinet";

const row = (over: Partial<CabinetRequestRow> = {}): CabinetRequestRow => ({
  id: "01REQ",
  side: "owner",
  status: "new",
  dateFrom: "2026-09-12",
  dateTo: "2026-09-14",
  qty: 1,
  createdAt: new Date("2026-09-09T10:00:00Z"),
  expiresAt: new Date("2026-09-10T10:00:00Z"),
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
    expect(toFeedRow(row()).estimate).toBe(300 * 3);
    expect(toFeedRow(row({ qty: 2 })).estimate).toBe(300 * 3 * 2);
  });

  it("горит только новая заявка владельцу", () => {
    expect(toFeedRow(row()).hot).toBe(true);
    expect(toFeedRow(row({ side: "customer" })).hot).toBe(false);
    expect(toFeedRow(row({ status: "confirmed" })).hot).toBe(false);
  });
});

describe("sortFeedRows", () => {
  it("требующее действия — выше идущего, закрытые позади", () => {
    const rows = [
      toFeedRow(row({ id: "closed", status: "declined" })),
      toFeedRow(row({ id: "running", status: "confirmed" })),
      toFeedRow(row({ id: "hot" })),
    ];
    expect(sortFeedRows(rows).map((r) => r.id)).toEqual(["hot", "running", "closed"]);
  });
});
