// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/* Владелец отменяет подтверждённую бронь. Раньше отменить её мог только
 * арендатор — у владельца, чья вещь сломалась, оставалась «Неявка», то есть
 * обвинение клиента.
 *
 * Проверяем ровно два инварианта, которые легко потерять: отмена ограничена
 * подтверждённой (машина разрешает и `new → cancelled`, а экшен доступен по
 * сети мимо интерфейса) и она освобождает даты. */

const { authMock, transaction, availUpdate } = vi.hoisted(() => ({
  authMock: vi.fn(),
  transaction: vi.fn(),
  availUpdate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ transaction }) }));
vi.mock("@/server/notifications", () => ({ notify: vi.fn(async () => ({ inserted: true })) }));
vi.mock("@/server/realtime", () => ({ publish: vi.fn() }));
vi.mock("@/server/deal-note", () => ({ writeDealNote: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// after() живёт только внутри запроса — в тесте его нет, письмо мокается.
vi.mock("@/server/booking-mail", () => ({ queueBookingMail: vi.fn() }));

import { cancelConfirmedByOwner, completeRequest } from "@/server/actions/owner";
import { todayStr, addDaysStr } from "@/lib/catalog/dates";

const OWNER = "01OWNER";
const LISTING = "01LISTING";

/* Даты — относительно сегодня, а не календарные: досрочное закрытие
 * освобождает только будущее, и на фиксированных числах тест перестал бы
 * проверять освобождение в тот день, когда они станут прошлым. */
const request = (status: string) => ({
  id: "01REQ",
  listingId: LISTING,
  ownerUserId: OWNER,
  customerUserId: "01CUSTOMER",
  status,
  dateFrom: addDaysStr(todayStr(), 1),
  dateTo: addDaysStr(todayStr(), 3),
  qty: 2,
});

// Транзакция подставляет заявку в нужном статусе и запоминает, обновлялась ли
// занятость.
/* Фейковая транзакция повторяет НАСТОЯЩИЙ порядок обращений мутации:
 * 1) заявка без блокировки — узнать, какая это вещь;
 * 2) объявление FOR UPDATE — правило LOCK ORDER в шапке owner.ts;
 * 3) заявка и соседи одним упорядоченным запросом FOR UPDATE.
 * Порядок зафиксирован: сломается он в коде — тест это заметит. */
function runWith(status: string) {
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const req = request(status);
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            // Шаг 1: без блокировки.
            limit: async () => [{ listingId: LISTING, ownerUserId: req.ownerUserId }],
            // Шаг 2: объявление под блокировкой.
            for: () => ({ limit: async () => [{ id: LISTING, quantity: 1 }] }),
            // Шаг 3: набор заявок под блокировкой.
            orderBy: () => ({ for: () => ({ limit: async () => [req] }) }),
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async (cond: unknown) => {
            if ("bookedQty" in values) availUpdate(values, cond);
          },
        }),
      }),
      insert: () => ({ values: async () => undefined }),
    };
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

/* Вещь вернули раньше срока. Аренда состоялась, но остаток дней обязан
 * вернуться в продажу — иначе владелец, которому вещь принесли на день
 * раньше, не может её сдать, а «Отменить бронь» тут врёт: аренда была. */
describe("completeRequest — закрытие досрочно", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: OWNER, bannedAt: null } });
    availUpdate.mockReset();
    transaction.mockReset();
  });

  it("закрывает подтверждённую и освобождает даты", async () => {
    runWith("confirmed");
    const r = await completeRequest("01REQ");
    expect(r.ok).toBe(true);
    expect(availUpdate).toHaveBeenCalledTimes(1);
  });

  /* Граница по дате, а не по знаку: прожитые дни вещь действительно была
   * занята, и делать вид, что она была свободна, нельзя. Поэтому условие
   * освобождения несёт сегодняшнюю деловую дату. */
  it("освобождает строго будущее — сегодняшняя дата в условии", () => {
    const seen = new Set<unknown>();
    const has = (node: unknown, needle: string): boolean => {
      if (node === needle) return true;
      if (typeof node !== "object" || node === null || seen.has(node)) return false;
      seen.add(node);
      return Object.values(node).some((v) => has(v, needle));
    };
    return (async () => {
      runWith("confirmed");
      await completeRequest("01REQ");
      const [, cond] = availUpdate.mock.calls[0];
      expect(has(cond, todayStr())).toBe(true);
    })();
  });

  /* Вторая половина той же границы: закрытие в последний день аренды
   * календарь не трогает вовсе. Освобождать нечего — будущего у брони не
   * осталось, а запрос без строк всё равно списал бы блокировку. */
  it("в последний день аренды календарь не трогает", async () => {
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const req = { ...request("confirmed"), dateTo: todayStr() };
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [{ listingId: LISTING, ownerUserId: OWNER }],
              for: () => ({ limit: async () => [{ id: LISTING, quantity: 1 }] }),
              orderBy: () => ({ for: () => ({ limit: async () => [req] }) }),
            }),
          }),
        }),
        update: () => ({
          set: (values: Record<string, unknown>) => ({
            where: async (cond: unknown) => {
              if ("bookedQty" in values) availUpdate(values, cond);
            },
          }),
        }),
        insert: () => ({ values: async () => undefined }),
      };
      await fn(tx);
    });
    expect((await completeRequest("01REQ")).ok).toBe(true);
    expect(availUpdate).not.toHaveBeenCalled();
  });

  // Закрывать нечего, пока бронь не подтверждена.
  it("новую заявку закрыть нельзя", async () => {
    runWith("new");
    expect(await completeRequest("01REQ")).toEqual({ ok: false, error: "bad_status" });
    expect(availUpdate).not.toHaveBeenCalled();
  });
});
