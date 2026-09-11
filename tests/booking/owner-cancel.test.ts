// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/* Владелец закрывает подтверждённую бронь. Способов два, и они отвечают на
 * разные вопросы: «сделка расторгнута» (cancelled, освобождает всё) и «вещь
 * вернули раньше срока» (completed, освобождает остаток). Состоявшуюся вовремя
 * аренду не отмечают вовсе — она закрывается сама, см. ADR 0018.
 *
 * Проверяем то, что легко потерять: ограничение по статусу (машина разрешает и
 * `new → cancelled`, а экшен доступен по сети мимо интерфейса), обе границы
 * освобождаемого окна и то, что чужую заявку не тронуть. */

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
import { renderSql } from "../fixtures/render-sql";

const OWNER = "01OWNER";
const LISTING = "01LISTING";
const TODAY = todayStr();

/* Даты — относительно сегодня, а не календарные: досрочное закрытие смотрит на
 * сегодняшний день с обеих сторон, и на фиксированных числах тест перестал бы
 * проверять освобождение в тот день, когда они станут прошлым. */
const request = (status: string, over: Record<string, unknown> = {}) => ({
  id: "01REQ",
  listingId: LISTING,
  ownerUserId: OWNER,
  customerUserId: "01CUSTOMER",
  status,
  dateFrom: addDaysStr(TODAY, -1),
  dateTo: addDaysStr(TODAY, 2),
  qty: 2,
  ...over,
});

/* Фейковая транзакция повторяет НАСТОЯЩИЙ порядок обращений мутации:
 * 1) заявка без блокировки — узнать, какая это вещь;
 * 2) объявление FOR UPDATE — правило LOCK ORDER в шапке owner.ts;
 * 3) заявка и соседи одним упорядоченным запросом FOR UPDATE.
 * Порядок зафиксирован: сломается он в коде — тест это заметит. */
function runWith(status: string, over: Record<string, unknown> = {}) {
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const req = request(status, over);
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

// Условие последнего освобождения дат — настоящим SQL.
const freedDatesSql = () => renderSql(availUpdate.mock.calls[0][1]);

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

  /* Отмена освобождает ВЕСЬ диапазон, включая прожитые дни: договорённость
   * рушится целиком, и делить её на «до» и «после» нечем. Этим она и
   * отличается от досрочного закрытия — там граница по сегодняшнему дню есть. */
  it("отмена освобождает весь диапазон, а не остаток", async () => {
    runWith("confirmed");
    await cancelConfirmedByOwner("01REQ");
    const sql = freedDatesSql();
    expect(sql).toContain(`>= '${addDaysStr(TODAY, -1)}'`);
    expect(sql).toContain(`<= '${addDaysStr(TODAY, 2)}'`);
    expect(sql).not.toContain(`'${TODAY}'`);
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

  /* Обе границы окна — настоящим SQL, а не поиском даты в дереве условия:
   * подмена `>` на `>=` сдвинула бы освобождение на сегодняшний день, когда
   * вещь ещё была у арендатора, и обход дерева этого не заметил бы. */
  it("освобождает строго будущее: сегодня занят, завтра свободен", async () => {
    runWith("confirmed");
    await completeRequest("01REQ");
    const sql = freedDatesSql();
    expect(sql).toContain(`"availability"."date" > '${TODAY}'`);
    expect(sql).toContain(`"availability"."date" <= '${addDaysStr(TODAY, 2)}'`);
  });

  /* Вторая половина той же границы: закрытие в последний день аренды
   * календарь не трогает вовсе. Освобождать нечего — будущего у брони не
   * осталось, а запрос без строк всё равно списал бы блокировку. */
  it("в последний день аренды календарь не трогает", async () => {
    runWith("confirmed", { dateTo: TODAY });
    expect((await completeRequest("01REQ")).ok).toBe(true);
    expect(availUpdate).not.toHaveBeenCalled();
  });

  /* Нижняя граница. Без неё «вернули раньше» закрывало бы бронь, которая ещё
   * не начиналась: освобождался бы весь диапазон, а аренда, которой не было,
   * попадала в публичный счётчик сделок. Не начавшуюся расторгают, а не
   * завершают. */
  it("не начавшуюся аренду закрыть нельзя — её отменяют", async () => {
    runWith("confirmed", { dateFrom: addDaysStr(TODAY, 1), dateTo: addDaysStr(TODAY, 3) });
    expect(await completeRequest("01REQ")).toEqual({ ok: false, error: "not_started" });
    expect(availUpdate).not.toHaveBeenCalled();
  });

  // Первый день аренды — уже можно: вещь успели взять и вернуть.
  it("в первый день аренды закрыть можно", async () => {
    runWith("confirmed", { dateFrom: TODAY, dateTo: addDaysStr(TODAY, 2) });
    expect((await completeRequest("01REQ")).ok).toBe(true);
    expect(freedDatesSql()).toContain(`"availability"."date" > '${TODAY}'`);
  });

  // Закрывать нечего, пока бронь не подтверждена.
  it("новую заявку закрыть нельзя", async () => {
    runWith("new");
    expect(await completeRequest("01REQ")).toEqual({ ok: false, error: "bad_status" });
    expect(availUpdate).not.toHaveBeenCalled();
  });
});
