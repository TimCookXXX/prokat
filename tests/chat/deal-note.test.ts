// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/* Запись о сделке в переписке. Проверяем форму записи и то, что она не
 * притворяется репликой: у неё нет ни автора, ни текста, она не поднимает
 * счётчик и не двигает курсоры прочтения. */

const { publishMock } = vi.hoisted(() => ({ publishMock: vi.fn() }));
vi.mock("@/server/realtime", () => ({ publish: publishMock }));

const { writeDealNote } = await import("@/server/deal-note");
const { chatMessages, chatThreads } = await import("@db/schema");

const LISTING = "01LISTING";
const OWNER = "01OWNER";
const CUSTOMER = "01CUSTOMER";
const THREAD = "01THREAD";

// Транзакция ровно той формы, что нужна писателю: вставка треда, выборка его
// id, вставка сообщения, обновление свежести.
function fakeTx() {
  // Таблицу опознаём по ссылке, а не по имени: внутреннее устройство объекта
  // таблицы у drizzle меняется от версии к версии, а ссылка — нет.
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const updated: Array<Record<string, unknown>> = [];
  const tx = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserted.push({ table, values });
        return { onConflictDoNothing: async () => undefined };
      },
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: THREAD }] }) }) }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => { updated.push(v); } }) }),
  };
  return { tx, inserted, updated };
}

const note = {
  listingId: LISTING,
  ownerUserId: OWNER,
  customerUserId: CUSTOMER,
  kind: "request_created" as const,
  meta: { requestId: "01REQ", from: "2026-09-12", to: "2026-09-14", qty: 2 },
};

describe("writeDealNote", () => {
  beforeEach(() => publishMock.mockReset());

  it("пишет запись без автора и без текста", async () => {
    const { tx, inserted } = fakeTx();
    await writeDealNote(tx as never, note);

    const message = inserted.find((i) => i.table === chatMessages);
    expect(message).toBeDefined();
    expect(message?.values.senderUserId).toBeNull();
    expect(message?.values.body).toBeNull();
    expect(message?.values.kind).toBe("request_created");
    expect(message?.values.metaJson).toEqual(note.meta);
  });

  /* Тред заводится сам: владелец собственный начать не может, а у заявок,
   * созданных до появления журнала, треда нет вовсе. */
  it("заводит тред, если его ещё нет", async () => {
    const { tx, inserted } = fakeTx();
    await writeDealNote(tx as never, note);

    const thread = inserted.find((i) => i.table === chatThreads);
    expect(thread?.values).toMatchObject({
      listingId: LISTING, ownerUserId: OWNER, customerUserId: CUSTOMER,
    });
  });

  // Свежесть двигаем, курсоры прочтения — нет: запись непрочитанной не бывает.
  it("двигает свежесть треда и не трогает курсоры", async () => {
    const { tx, updated } = fakeTx();
    await writeDealNote(tx as never, note);

    expect(updated).toHaveLength(1);
    expect(Object.keys(updated[0])).toEqual(["lastMessageAt"]);
  });

  /* Счётчик не поднимаем: о случившемся уже сказало событие по заявке, и
   * второй бейдж на то же самое зажигаться не должен. А доехать до открытой
   * ленты запись обязана — поэтому событие всё равно публикуется. */
  it("публикует событие, но счётчик не поднимает", async () => {
    const { tx } = fakeTx();
    await writeDealNote(tx as never, note);

    expect(publishMock).toHaveBeenCalledTimes(1);
    const payload = publishMock.mock.calls[0][1];
    expect(payload.kind).toBe("chat_message");
    expect(payload.countFor).toBeNull();
    expect(payload.recipients).toEqual(expect.arrayContaining([OWNER, CUSTOMER]));
  });
});
