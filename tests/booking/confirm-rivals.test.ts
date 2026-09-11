// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/* Автоотклонение конкурентов при подтверждении — самое рискованное место
 * этапа, и до этого теста его не касался никто. Проверяем три инварианта:
 * закрываются только пересекающиеся по датам; помещающиеся при quantity > 1
 * не трогаются; каждый закрытый получает запись в журнал и уведомление. */

const { authMock, transaction, dealNoteMock, notifyMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  transaction: vi.fn(),
  dealNoteMock: vi.fn(),
  notifyMock: vi.fn(async () => ({ inserted: true })),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ transaction }) }));
vi.mock("@/server/notifications", () => ({ notify: notifyMock }));
vi.mock("@/server/realtime", () => ({ publish: vi.fn() }));
vi.mock("@/server/deal-note", () => ({ writeDealNote: dealNoteMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// after() живёт только внутри запроса — в тесте его нет, письмо мокается.
vi.mock("@/server/booking-mail", () => ({ queueBookingMail: vi.fn() }));

import { confirmRequest } from "@/server/actions/owner";

const OWNER = "01OWNER";
const LISTING = "01LISTING";

type Req = {
  id: string; listingId: string; ownerUserId: string; customerUserId: string;
  status: string; dateFrom: string; dateTo: string; qty: number;
};

const req = (id: string, from: string, to: string, over: Partial<Req> = {}): Req => ({
  id, listingId: LISTING, ownerUserId: OWNER, customerUserId: `c-${id}`,
  status: "new", dateFrom: from, dateTo: to, qty: 1, ...over,
});

/* Фейк повторяет настоящий порядок обращений: заявка без блокировки →
 * объявление FOR UPDATE → набор заявок FOR UPDATE → занятость → upsert.
 * Занятость отдаём пустой: подтверждаемая заявка помещается всегда, а
 * «не помещается» для конкурентов считаем по updates. */
function run(requests: Req[], quantity: number, blockedDays: string[] = []) {
  const declined: string[] = [];
  // Занятость, которую видит пересчёт конкурента: после upsert подтверждённой
  // заявки каждый её день занят на qty подтверждённой.
  const confirmed = requests[0];
  const bookedDays = new Set<string>();
  {
    const [y, m, d] = confirmed.dateFrom.split("-").map(Number);
    const to = confirmed.dateTo;
    const cur = new Date(Date.UTC(y, m - 1, d));
    for (;;) {
      const iso = cur.toISOString().slice(0, 10);
      bookedDays.add(iso);
      if (iso === to) break;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    /* where() и for() у выборок занятости await'ятся без limit, поэтому фейк
     * делает оба thenable. Какой массив отдать, решаем по числу столбцов и
     * порядку: у head два поля, у занятости строки по дням. */
    const availability = () => [
      ...[...bookedDays].map((date) => ({ date, bookedQty: confirmed.qty, blockedQty: 0 })),
      ...blockedDays.map((date) => ({ date, bookedQty: 0, blockedQty: quantity })),
    ];
    const thenable = (rows: () => unknown[]) => ({
      then: (resolve: (v: unknown[]) => void) => Promise.resolve(rows()).then(resolve),
    });
    const tx = {
      select: () => {
        return {
          from: () => ({
            where: () => ({
              limit: async () => [{ listingId: LISTING, ownerUserId: OWNER }],
              for: () => ({
                limit: async () => [{ id: LISTING, quantity }],
                // Ветка confirmed читает занятость под блокировкой ДО upsert:
                // там пусто — подтверждаемая заявка обязана помещаться.
                ...thenable(() => []),
              }),
              orderBy: () => ({ for: () => ({ limit: async () => requests }) }),
              // Пересчёт для конкурента идёт ПОСЛЕ upsert подтверждённой:
              // он видит её дни занятыми.
              ...thenable(availability),
            }),
          }),
        };
      },
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            if (values.status === "declined") declined.push("x");
          },
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: async () => undefined,
          onConflictDoNothing: async () => undefined,
        }),
      }),
    };
    await fn(tx);
  });
  return { declined };
}

describe("confirmRequest: конкуренты", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: OWNER, bannedAt: null } });
    dealNoteMock.mockClear();
    notifyMock.mockClear();
    transaction.mockReset();
  });

  /* Ровно случай из ревью: конкурент на октябрь лежит на датах, закрытых
   * руками, — то есть «не помещается», но НЕ из-за этого подтверждения.
   * Без фильтра пересечения сентябрьское подтверждение отклоняло бы его,
   * хотя оно тут ни при чём: судьбу таких заявок решает срок, а не чужая
   * бронь. Пересчёт занятости этого не ловит — только фильтр. */
  it("непересекающийся конкурент не закрывается, даже когда он не помещается", async () => {
    const requests = [
      req("01A", "2026-09-12", "2026-09-14"),
      req("01B", "2026-10-01", "2026-10-01"),
    ];
    run(requests, 1, ["2026-10-01"]);
    const r = await confirmRequest("01A");
    expect(r.ok).toBe(true);
    // Журнал получил только запись о подтверждении, без отказов.
    const kinds = dealNoteMock.mock.calls.map((c) => c[1].kind);
    expect(kinds).toEqual(["request_confirmed"]);
  });

  /* Вещей две, конкурент просит одну на пересекающиеся даты — он всё ещё
   * помещается, и закрывать его нельзя: это то самое место, где пересечение
   * диапазонов без пересчёта занятости давало бы ложный отказ. */
  it("помещающийся при quantity > 1 не закрывается", async () => {
    const requests = [
      req("01A", "2026-09-12", "2026-09-14"),
      req("01B", "2026-09-13", "2026-09-15"),
    ];
    run(requests, 2);
    const r = await confirmRequest("01A");
    expect(r.ok).toBe(true);
    const kinds = dealNoteMock.mock.calls.map((c) => c[1].kind);
    expect(kinds).toEqual(["request_confirmed"]);
  });

  it("пересекающийся и не помещающийся — закрывается с журналом и уведомлением", async () => {
    const requests = [
      req("01A", "2026-09-12", "2026-09-14"),
      req("01B", "2026-09-13", "2026-09-15"),
    ];
    run(requests, 1);
    const r = await confirmRequest("01A");
    expect(r.ok).toBe(true);

    const kinds = dealNoteMock.mock.calls.map((c) => c[1].kind);
    expect(kinds).toEqual(["request_declined", "request_confirmed"]);
    // Уведомление об отказе адресовано арендатору конкурента.
    const declineNote = dealNoteMock.mock.calls.find((c) => c[1].kind === "request_declined")![1];
    expect(declineNote.customerUserId).toBe("c-01B");
  });
});
