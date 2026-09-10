import { describe, it, expect } from "vitest";
import { disclosedPhone, requestSide } from "@/lib/booking/request-access";
import type { BookingStatus } from "@/lib/catalog/booking-status";

const OWNER = "u-owner";
const CUSTOMER = "u-customer";

// Перебор по всем статусам, а не по горстке: список закрыт, и восьмой статус
// не должен добавиться молча в обход правила раскрытия.
const ALL_STATUSES = [
  "new", "confirmed", "declined", "expired", "completed", "no_show", "cancelled",
] as const satisfies readonly BookingStatus[];

// Полнота проверяется типом: пропущенный статус превратит тип в false, и
// присваивание true перестанет компилироваться.
type Uncovered = Exclude<BookingStatus, (typeof ALL_STATUSES)[number]>;
const _allStatusesCovered: [Uncovered] extends [never] ? true : false = true;
void _allStatusesCovered;

const request = (status: BookingStatus, ownerPhone: string | null = "+79000000002") => ({
  ownerUserId: OWNER,
  customerUserId: CUSTOMER,
  status,
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

  it("арендатор не видит телефон владельца до подтверждения", () => {
    // Иначе рассылка заявок веером собирала бы чужие контакты.
    for (const status of ALL_STATUSES.filter((s) => s !== "confirmed")) {
      expect(disclosedPhone(request(status), CUSTOMER)).toBeNull();
    }
  });

  it("после подтверждения арендатор видит телефон владельца", () => {
    expect(disclosedPhone(request("confirmed"), CUSTOMER)).toBe("+79000000002");
  });

  it("незаполненный телефон владельца остаётся пустым, а не падает", () => {
    expect(disclosedPhone(request("confirmed", null), CUSTOMER)).toBeNull();
  });

  it("постороннему не видно ничего", () => {
    expect(disclosedPhone(request("confirmed"), "u-stranger")).toBeNull();
  });
});
