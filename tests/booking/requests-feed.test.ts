// @vitest-environment node
import { describe, it, expect } from "vitest";
import { toFeedRow, sortFeedRows, summaryRows } from "@/server/requests-feed";
import type { FeedRow } from "@/components/cabinet/RequestsFeed";
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
  priceDay: 300,
  depositType: "none",
  depositAmount: null,
  listing: {
    id: "01L", title: "Мангал", slug: "mangal", citySlug: "krasnodar",
    categorySlug: "grili", status: "active", ownerBannedAt: null,
    image: null,
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

/* Порядок строк сводки. Правило здесь другое, чем у ленты, и цена ошибки выше:
 * панель режется до восьми строк, и неверная сортировка выбрасывает не хвост,
 * а самое срочное.
 *
 * Ловушка, ради которой тест и написан: expiresAt ставится как «создано + 24
 * часа» одной константой, поэтому «свежие сверху» — это ровно ОБРАТНЫЙ порядок
 * к «горит раньше». Сортируй сводка по createdAt, как лента, — и наверх
 * поднялось бы то, у чего времени больше всех. */
describe("summaryRows", () => {
  const at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const req = (id: string, over: Partial<FeedRow> = {}): FeedRow =>
    ({ ...toFeedRow(row()), id, ...over }) as FeedRow;

  it("ждущие ответа идут первыми, и первым — то, что сгорит раньше", () => {
    const rows = [
      req("поздняя", { status: "new", expiresAt: at(20) }),
      req("идёт", { status: "confirmed", dateFrom: "2026-09-01" }),
      req("срочная", { status: "new", expiresAt: at(2) }),
    ];
    expect(summaryRows(rows, 8).shown.map((r) => r.id))
      .toEqual(["срочная", "поздняя", "идёт"]);
  });

  it("идущие — по дате начала: ближайшая передача впереди", () => {
    const rows = [
      req("позже", { status: "confirmed", dateFrom: "2026-09-20" }),
      req("скоро", { status: "confirmed", dateFrom: "2026-09-12" }),
    ];
    expect(summaryRows(rows, 8).shown.map((r) => r.id)).toEqual(["скоро", "позже"]);
  });

  /* Режем ПОСЛЕ сортировки. Лимитом в SQL это делать нельзя — он применяется
   * до неё, и из панели вылетели бы ровно те заявки, ради которых она есть. */
  it("срез оставляет самое срочное, а не самое свежее", () => {
    const rows = [
      req("a", { status: "new", expiresAt: at(20) }),
      req("b", { status: "new", expiresAt: at(1) }),
      req("c", { status: "new", expiresAt: at(10) }),
    ];
    const { shown, rest } = summaryRows(rows, 2);
    expect(shown.map((r) => r.id)).toEqual(["b", "c"]);
    expect(rest).toBe(1);
  });

  it("остаток честный, и нуль не уходит в минус", () => {
    expect(summaryRows([req("a")], 8).rest).toBe(0);
    expect(summaryRows([], 8)).toEqual({ shown: [], rest: 0 });
  });
});
