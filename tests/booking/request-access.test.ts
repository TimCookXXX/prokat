import { describe, it, expect } from "vitest";
import { disclosedPhone, requestSide } from "@/lib/booking/request-access";
import type { BookingStatus } from "@/lib/catalog/booking-status";

const OWNER = "u-owner";
const CUSTOMER = "u-customer";

// Перебор по всем статусам, а не по горстке: список закрыт, и новый статус
// не должен добавиться молча в обход правила раскрытия.
const ALL_STATUSES = [
  "new", "confirmed", "declined", "expired", "completed", "cancelled",
] as const satisfies readonly BookingStatus[];

// Полнота проверяется типом: пропущенный статус превратит тип в false, и
// присваивание true перестанет компилироваться.
type Uncovered = Exclude<BookingStatus, (typeof ALL_STATUSES)[number]>;
const _allStatusesCovered: [Uncovered] extends [never] ? true : false = true;
void _allStatusesCovered;

const CONFIRMED_AT = new Date("2026-09-10T12:00:00Z");

/* Правило раскрытия смотрит на отметку подтверждения, а не на статус: по
 * статусу «подтверждали ли когда-нибудь» не узнать — cancelled бывает и у
 * новой заявки, которую отозвали, не получив ничьего согласия. */
const request = (
  status: BookingStatus,
  confirmedAt: Date | null = null,
  ownerPhone: string | null = "+79000000002",
) => ({
  ownerUserId: OWNER,
  customerUserId: CUSTOMER,
  status,
  confirmedAt,
  customerPhone: "+79000000001",
  ownerPhone,
});

describe("requestSide", () => {
  it("узнаёт обе стороны", () => {
    expect(requestSide(request("new"), OWNER)).toBe("owner");
    expect(requestSide(request("new"), CUSTOMER)).toBe("customer");
  });

  // Сторож на случай, если условие выборки когда-нибудь ослабят: чужая строка
  // не должна получить ни роли, ни телефона.
  it("посторонний стороной не становится", () => {
    expect(requestSide(request("new"), "u-stranger")).toBeNull();
  });
});

describe("disclosedPhone", () => {
  it("владелец видит телефон клиента на любом статусе", () => {
    // Решение по заявке принимается созвоном — без телефона решать нечем.
    for (const status of ALL_STATUSES) {
      expect(disclosedPhone(request(status), OWNER)).toBe("+79000000001");
    }
  });

  /* Сторож полноты: ни один статус сам по себе телефона не открывает. Пока
   * основанием был статус, перебор ловил бы добавленный молча; теперь
   * ту же работу делает эта пара — без отметки закрыто всегда, с отметкой
   * открыто всегда, какой бы статус ни появился. */
  it("без отметки подтверждения закрыт на любом статусе", () => {
    // Иначе рассылка заявок веером собирала бы чужие контакты.
    for (const status of ALL_STATUSES) {
      expect(disclosedPhone(request(status), CUSTOMER)).toBeNull();
    }
  });

  it("с отметкой подтверждения открыт на любом статусе", () => {
    for (const status of ALL_STATUSES) {
      expect(disclosedPhone(request(status, CONFIRMED_AT), CUSTOMER)).toBe("+79000000002");
    }
  });

  /* Главная новая развилка. Отменённая бронь и отозванная заявка носят один
   * статус, а телефон у них разный: после согласия отбирать контакт незачем —
   * номер уже видели, и договариваться о возврате всё равно придётся. */
  it("cancelled: после подтверждения открыт, без подтверждения — нет", () => {
    expect(disclosedPhone(request("cancelled", CONFIRMED_AT), CUSTOMER)).toBe("+79000000002");
    expect(disclosedPhone(request("cancelled"), CUSTOMER)).toBeNull();
  });

  it("незаполненный телефон владельца остаётся пустым, а не падает", () => {
    expect(disclosedPhone(request("confirmed", CONFIRMED_AT, null), CUSTOMER)).toBeNull();
  });

  it("постороннему не видно ничего", () => {
    expect(disclosedPhone(request("confirmed", CONFIRMED_AT), "u-stranger")).toBeNull();
  });
});
