// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/* Владелец отменяет подтверждённую бронь. Раньше отменить её мог только
 * арендатор — у владельца, чья вещь сломалась, оставалась «Неявка», то есть
 * обвинение клиента.
 *
 * Проверяем ровно два инварианта, которые легко потерять: отмена ограничена
 * подтверждённой (машина разрешает и `new → cancelled`, а экшен доступен по
 * сети мимо интерфейса) и она освобождает даты. */

const { authMock, transaction, forUpdate, availUpdate } = vi.hoisted(() => ({
  authMock: vi.fn(),
  transaction: vi.fn(),
  forUpdate: vi.fn(),
  availUpdate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ transaction }) }));
vi.mock("@/server/notifications", () => ({ notify: vi.fn(async () => ({ inserted: true })) }));
vi.mock("@/server/realtime", () => ({ publish: vi.fn() }));
vi.mock("@/server/deal-note", () => ({ writeDealNote: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { cancelConfirmedByOwner } from "@/server/actions/owner";

const OWNER = "01OWNER";

const request = (status: string) => ({
  id: "01REQ",
  listingId: "01LISTING",
  ownerUserId: OWNER,
  customerUserId: "01CUSTOMER",
  status,
  dateFrom: "2026-09-12",
  dateTo: "2026-09-14",
  qty: 2,
});

// Транзакция подставляет заявку в нужном статусе и запоминает, обновлялась ли
// занятость.
function runWith(status: string) {
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const tx = {
      select: () => ({
        from: () => ({ where: () => ({ for: () => ({ limit: forUpdate }) }) }),
      }),
      update: (table: { toString?: () => string }) => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            if ("bookedQty" in values) availUpdate(values);
          },
        }),
      }),
      insert: () => ({ values: async () => undefined }),
    };
    forUpdate.mockResolvedValue([request(status)]);
    await fn(tx);
  });
}

describe("cancelConfirmedByOwner", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: OWNER, bannedAt: null } });
    availUpdate.mockReset();
    transaction.mockReset();
  });

  it("подтверждённую отменяет и освобождает даты", async () => {
    runWith("confirmed");
    const r = await cancelConfirmedByOwner("01REQ");
    expect(r.ok).toBe(true);
    expect(availUpdate).toHaveBeenCalledTimes(1);
  });

  /* Машина переходов разрешает `new → cancelled`, поэтому без ограничения по
   * статусу владелец «отменял» бы новую заявку вместо отказа: другое
   * уведомление, другая запись в журнале и ни слова клиенту. */
  it("новую заявку отменить не даёт — для неё есть отказ", async () => {
    runWith("new");
    const r = await cancelConfirmedByOwner("01REQ");
    expect(r).toEqual({ ok: false, error: "bad_status" });
    expect(availUpdate).not.toHaveBeenCalled();
  });

  it("чужую заявку не трогает", async () => {
    authMock.mockResolvedValue({ user: { id: "01STRANGER", bannedAt: null } });
    runWith("confirmed");
    const r = await cancelConfirmedByOwner("01REQ");
    expect(r).toEqual({ ok: false, error: "not_found" });
  });
});
