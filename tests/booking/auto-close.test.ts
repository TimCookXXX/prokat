// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/* Аренда закрывается сама, когда даты прошли. Итог следует из календаря, а не
 * из нажатия владельца: отмечать состоявшуюся аренду его больше не просят, и
 * кнопки «Завершена» нет вовсе (ADR 0018).
 *
 * Проверяем две вещи, которые легко потерять: границу дня и то, что закрытие
 * идёт по ДЕЛОВОМУ дню, а не по часам процесса. */

const { where, set, update } = vi.hoisted(() => {
  const where = vi.fn(async (..._a: unknown[]) => undefined);
  const set = vi.fn((_v: Record<string, unknown>) => ({ where }));
  return { where, set, update: vi.fn(() => ({ set })) };
});

vi.mock("@/lib/db", () => ({ getDb: () => ({ update }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// booking.ts тянет auth транзитивно — в jsdom/node его модулей нет.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/server/notifications", () => ({ notify: vi.fn() }));
vi.mock("@/server/realtime", () => ({ publish: vi.fn() }));
vi.mock("@/server/deal-note", () => ({ writeDealNote: vi.fn() }));
vi.mock("@/server/booking-mail", () => ({ queueBookingMail: vi.fn() }));
// cache() из react в тесте не нужен — зовём функцию напрямую.
vi.mock("react", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  cache: (fn: unknown) => fn,
}));

const { expireStaleRequests } = await import("@/server/actions/booking");
const { todayStr } = await import("@/lib/catalog/dates");
const { renderSql } = await import("../fixtures/render-sql");

describe("ленивая уборка", () => {
  beforeEach(() => { set.mockClear(); where.mockClear(); update.mockClear(); });

  it("делает две уборки: протухание и закрытие", async () => {
    await expireStaleRequests();
    const statuses = set.mock.calls.map((c) => c[0].status);
    expect(statuses).toEqual(["expired", "completed"]);
  });

  /* Граница закрытия — настоящим SQL, а не поиском даты в дереве условия:
   * подмена `<` на `<=` закрывала бы аренду в её ПОСЛЕДНИЙ день, когда вещь
   * ещё у арендатора, а дата в условии осталась бы та же.
   *
   * Деловой день, а не current_date базы: у контейнера db зона не задана, и с
   * полуночи до трёх ночи по Москве он отдавал бы вчерашний день — закрытие
   * опаздывало бы на три часа. */
  it("закрывает только те, у кого последний день уже прошёл", async () => {
    await expireStaleRequests();
    const sql = renderSql(where.mock.calls[1][0]);
    expect(sql).toContain(`"booking_requests"."date_to" < '${todayStr()}'`);
    expect(sql).toContain(`"booking_requests"."status" = 'confirmed'`);
  });

  // Протухание закрывает только ждущие ответа: подтверждённую бронь срок
  // ответа уже не касается.
  it("протухание трогает только новые заявки", async () => {
    await expireStaleRequests();
    expect(renderSql(where.mock.calls[0][0])).toContain(`"booking_requests"."status" = 'new'`);
  });
});
