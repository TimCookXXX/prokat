import { describe, it, expect } from "vitest";
import { isUnreadFor } from "@/lib/chat/unread";

const ME = "01ME";
const THEM = "01THEM";

const reply = (id: string, sender: string | null) => ({ id, kind: "user", senderUserId: sender });

describe("isUnreadFor", () => {
  it("чужая реплика новее курсора — непрочитанная", () => {
    expect(isUnreadFor(reply("01B", THEM), ME, "01A")).toBe(true);
  });

  it("своя реплика непрочитанной не бывает", () => {
    expect(isUnreadFor(reply("01B", ME), ME, "01A")).toBe(false);
  });

  it("реплика не новее курсора уже прочитана", () => {
    expect(isUnreadFor(reply("01A", THEM), ME, "01A")).toBe(false);
    expect(isUnreadFor(reply("01A", THEM), ME, "01B")).toBe(false);
  });

  it("пустой курсор делает непрочитанным всё чужое", () => {
    expect(isUnreadFor(reply("01A", THEM), ME, null)).toBe(true);
  });

  /* Главное правило и главная ловушка. У записи о сделке отправителя нет, а
   * `null !== "01ME"` истинно — на сравнении с отправителем она посчиталась бы
   * чужой и подняла бы счётчик у ОБЕИХ сторон от их же собственного действия.
   * Поэтому вид проверяется отдельно, а не выводится из пустого отправителя. */
  it("запись о сделке непрочитанной не бывает ни у кого", () => {
    const note = { id: "01Z", kind: "request_created", senderUserId: null };
    expect(isUnreadFor(note, ME, null)).toBe(false);
    expect(isUnreadFor(note, THEM, null)).toBe(false);
  });

  it("вид важнее отправителя: запись с проставленным актором тоже молчит", () => {
    const note = { id: "01Z", kind: "request_confirmed", senderUserId: THEM };
    expect(isUnreadFor(note, ME, null)).toBe(false);
  });

  /* Реплика без автора. Схема такую строку не допускает
   * (chat_messages_kind_shape), но правило обязано быть верным само по себе:
   * без этой ветки JS считал бы её непрочитанной, а SQL — прочитанной, потому
   * что сравнение с NULL даёт NULL. */
  it("реплика без автора непрочитанной не считается", () => {
    expect(isUnreadFor({ id: "01Z", kind: "user", senderUserId: null }, ME, null)).toBe(false);
  });
});
