// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/* Аренда закрывается сама, когда даты прошли. Итог следует из календаря, а не
 * из нажатия владельца: отмечать состоявшуюся аренду его больше не просят, и
 * кнопок «Завершена» и «Неявка» нет вовсе.
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

describe("ленивая уборка", () => {
  beforeEach(() => { set.mockClear(); where.mockClear(); update.mockClear(); });

  it("делает две уборки: протухание и закрытие", async () => {
    await expireStaleRequests();
    const statuses = set.mock.calls.map((c) => c[0].status);
    expect(statuses).toEqual(["expired", "completed"]);
  });

  /* Деловой день, а не current_date базы: у контейнера db зона не задана, и
   * с полуночи до трёх ночи по Москве он отдавал бы вчерашний день —
   * закрытие опаздывало бы на три часа. */
  it("закрывает по деловому дню", async () => {
    await expireStaleRequests();
    // Условие drizzle — циклический объект, поэтому ищем значение обходом,
    // а не сериализацией.
    const found = new Set<unknown>();
    const has = (node: unknown, needle: string): boolean => {
      if (node === needle) return true;
      if (typeof node !== "object" || node === null || found.has(node)) return false;
      found.add(node);
      return Object.values(node).some((v) => has(v, needle));
    };
    expect(has(where.mock.calls[1], todayStr())).toBe(true);
  });
});
