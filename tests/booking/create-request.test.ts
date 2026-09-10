// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Моки через vi.hoisted: экшен импортируется статически, фабрики vi.mock
// исполняются раньше тела модуля.
const { authMock, listingLimit, availWhere, transaction, db, dealNoteMock } = vi.hoisted(() => {
  const dealNoteMock = vi.fn();
  const listingLimit = vi.fn();
  const availWhere = vi.fn();
  const transaction = vi.fn();
  return {
    dealNoteMock,
    authMock: vi.fn(),
    listingLimit,
    availWhere,
    transaction,
    // Экшен читает объявление с владельцем, потом занятость на диапазон,
    // и только потом заходит в транзакцию.
    db: {
      select: vi.fn((fields?: unknown) =>
        fields
          ? { from: () => ({ innerJoin: () => ({ where: () => ({ limit: listingLimit }) }) }) }
          : { from: () => ({ where: availWhere }) },
      ),
      transaction,
    },
  };
});
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/rate-limit", () => ({ checkLimit: () => ({ ok: true }) }));
vi.mock("@/server/notifications", () => ({ notify: vi.fn() }));
vi.mock("@/server/realtime", () => ({ publish: vi.fn() }));
vi.mock("@/server/deal-note", () => ({ writeDealNote: dealNoteMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// after() живёт только внутри запроса — в тесте его нет, письмо мокается.
vi.mock("@/server/booking-mail", () => ({ queueBookingMail: vi.fn() }));

import { createBookingRequest } from "@/server/actions/booking";
import { todayStr } from "@/lib/catalog/dates";

const TODAY = todayStr();

const form = (from: string, to: string) => ({
  listingId: "l1", from, to, qty: 1, phone: "+79000000000",
});

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1", bannedAt: null } });
  listingLimit.mockResolvedValue([
    { listing: { id: "l1", ownerUserId: "u2", status: "active", quantity: 1 }, ownerBannedAt: null },
  ]);
});

describe("createBookingRequest: устаревший выбор дат", () => {
  it("прошедшая дата не подтягивается к сегодня, а отклоняется", async () => {
    // Кламп молча сдвинул бы from на сегодня, и владелец получил бы заявку на
    // даты, которых человек не выбирал. Диалог показывает только «готово».
    const res = await createBookingRequest(form("2020-01-01", "2020-01-03"));
    expect(res).toEqual({ ok: false, error: "dates_stale" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("за горизонтом брони — тоже отказ, а не кламп", async () => {
    const res = await createBookingRequest(form("2099-01-01", "2099-01-02"));
    expect(res).toEqual({ ok: false, error: "dates_stale" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("сегодняшний день проходит проверку и доходит до занятости", async () => {
    // Занятость отдаём полной: доказывает, что охранник дат пропустил дальше,
    // не заводя транзакцию ради этого.
    availWhere.mockResolvedValue([
      { listingId: "l1", date: TODAY, bookedQty: 1, blockedQty: 0 },
    ]);
    const res = await createBookingRequest(form(TODAY, TODAY));
    expect(res).toEqual({ ok: false, error: `dates_taken:${TODAY}` });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("createBookingRequest: своё объявление", () => {
  // Подтвердив такую заявку, владелец занял бы собственные даты в обход
  // календаря занятости, а уведомлений за весь её цикл не пришло бы никому.
  it("владельцу отказ, а не заявка самому себе", async () => {
    listingLimit.mockResolvedValue([
      { listing: { id: "l1", ownerUserId: "u1", status: "active", quantity: 1 }, ownerBannedAt: null },
    ]);
    const res = await createBookingRequest(form(TODAY, TODAY));
    expect(res).toEqual({ ok: false, error: "own_listing" });
    expect(transaction).not.toHaveBeenCalled();
  });

  // Порядок отказов тот же, что в canStartThread: своё объявление называется
  // своим, даже когда оно снято с публикации.
  it("скрытое своё объявление тоже own_listing, а не listing_not_found", async () => {
    listingLimit.mockResolvedValue([
      { listing: { id: "l1", ownerUserId: "u1", status: "hidden", quantity: 1 }, ownerBannedAt: null },
    ]);
    const res = await createBookingRequest(form(TODAY, TODAY));
    expect(res).toEqual({ ok: false, error: "own_listing" });
  });
});

/* Количество клампилось молча: владелец мог уменьшить quantity, пока форма
 * открыта, и заявка уходила на меньшее число единиц, чем человек видел. Тот же
 * класс, что и сдвиг дат, — и отказ такой же явный. */
describe("createBookingRequest: количество", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: "u1", bannedAt: null } });
    availWhere.mockResolvedValue([]);
  });

  it("отказывает, если количество урезалось клампом", async () => {
    listingLimit.mockResolvedValue([{
      listing: { id: "l1", ownerUserId: "owner", status: "active", quantity: 1 },
      ownerBannedAt: null,
    }]);
    const r = await createBookingRequest({
      ...form(TODAY, TODAY), qty: 3,
    });
    expect(r).toEqual({ ok: false, error: "qty_stale" });
  });

  it("количество в пределах остатка пропускает", async () => {
    listingLimit.mockResolvedValue([{
      listing: { id: "l1", ownerUserId: "owner", status: "active", quantity: 5 },
      ownerBannedAt: null,
    }]);
    transaction.mockResolvedValue(undefined);
    const r = await createBookingRequest({ ...form(TODAY, TODAY), qty: 3 });
    expect(r.ok).toBe(true);
  });
});

/* Журнал сделки — главный инвариант этапа: пропуск одной записи оставляет в
 * треде дыру, которую ничем потом не восполнить. Без этой проверки удаление
 * вызова из мутации прошло бы все тесты. */
describe("createBookingRequest: журнал сделки", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: "u1", bannedAt: null } });
    availWhere.mockResolvedValue([]);
    listingLimit.mockResolvedValue([{
      listing: { id: "l1", ownerUserId: "owner", status: "active", quantity: 1 },
      ownerBannedAt: null,
    }]);
    dealNoteMock.mockClear();
    // Транзакция настоящая по форме: колбэк исполняется, писатель зовётся.
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        insert: () => ({ values: async () => undefined }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      };
      await fn(tx);
    });
  });

  it("открывает журнал записью о заявке", async () => {
    const r = await createBookingRequest(form(TODAY, TODAY));
    expect(r.ok).toBe(true);
    expect(dealNoteMock).toHaveBeenCalledTimes(1);
    const note = dealNoteMock.mock.calls[0][1];
    expect(note).toMatchObject({
      listingId: "l1", ownerUserId: "owner", customerUserId: "u1",
      kind: "request_created",
    });
    expect(note.meta).toMatchObject({ from: TODAY, to: TODAY, qty: 1 });
  });
});

/* Дубль ловится индексом, а не проверкой перед вставкой, и наружу выходит
 * человеческим отказом. Контракт с драйвером хрупкий — code и constraint лежат
 * на самой ошибке pg, и обёртка drizzle новых версий могла бы его сломать
 * молча. Тест фиксирует ровно ту форму, которую разбирает catch. */
describe("createBookingRequest: дубль", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: "u1", bannedAt: null } });
    availWhere.mockResolvedValue([]);
    listingLimit.mockResolvedValue([{
      listing: { id: "l1", ownerUserId: "owner", status: "active", quantity: 1 },
      ownerBannedAt: null,
    }]);
  });

  it("нарушение своего индекса становится duplicate_request", async () => {
    transaction.mockRejectedValue(Object.assign(new Error("duplicate key"), {
      code: "23505", constraint: "booking_requests_live_dup_uq",
    }));
    const r = await createBookingRequest(form(TODAY, TODAY));
    expect(r).toEqual({ ok: false, error: "duplicate_request" });
  });

  it("чужое нарушение уникальности пробрасывается", async () => {
    transaction.mockRejectedValue(Object.assign(new Error("duplicate key"), {
      code: "23505", constraint: "some_other_uq",
    }));
    await expect(createBookingRequest(form(TODAY, TODAY))).rejects.toThrow("duplicate key");
  });
});
