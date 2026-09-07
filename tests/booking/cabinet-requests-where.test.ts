// @vitest-environment node
// Условие выборки ленты заявок. База не нужна: drizzle умеет отрендерить
// запрос в SQL, не исполняя его, — этого хватает, чтобы проверить главное
// свойство, ради которого условие вынесено отдельной функцией.
import { describe, it, expect, vi } from "vitest";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { bookingRequests } from "@db/schema";

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/server/actions/booking", () => ({ expireStaleRequests: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { cabinetRequestsWhere, type CabinetRequestsOptions } from "@/server/cabinet";

const ME = "u-me";

function render(opts?: CabinetRequestsOptions) {
  return new QueryBuilder()
    .select({ id: bookingRequests.id })
    .from(bookingRequests)
    .where(cabinetRequestsWhere(ME, opts))
    .toSQL();
}

const OWNER_COL = '"booking_requests"."owner_user_id"';
const CUSTOMER_COL = '"booking_requests"."customer_user_id"';

describe("cabinetRequestsWhere", () => {
  it("права стоят всегда: заявка либо моя как владельца, либо моя как арендатора", () => {
    const { sql, params } = render();
    expect(sql).toContain(`${OWNER_COL} = $1 or ${CUSTOMER_COL} = $2`);
    expect(params).toEqual([ME, ME]);
  });

  // Главное свойство: role приходит из адреса, и подменять им базовый предикат
  // нельзя — иначе параметр расширял бы выдачу вместо того, чтобы её сужать.
  it("role добавляется через AND и базовое условие не вытесняет", () => {
    for (const role of ["owner", "customer"] as const) {
      const { sql } = render({ role });
      expect(sql).toContain(`${OWNER_COL} = $1 or ${CUSTOMER_COL} = $2`);
      const added = role === "owner" ? OWNER_COL : CUSTOMER_COL;
      expect(sql).toContain(`and ${added} = $3`);
    }
  });

  it("сужения по вещи и статусам тоже только добавляются", () => {
    const { sql, params } = render({ listingId: "l1", statuses: ["new", "confirmed"] });
    expect(sql).toContain(`${OWNER_COL} = $1 or ${CUSTOMER_COL} = $2`);
    expect(sql).toContain('"booking_requests"."listing_id" = $3');
    expect(params).toEqual([ME, ME, "l1", "new", "confirmed"]);
  });

  // Пустой фильтр статусов значит «ни одного», а не «любой»: иначе снятые в
  // интерфейсе галочки показали бы всю ленту вместо пустой.
  it("пустой список статусов даёт заведомо пустую выдачу", () => {
    expect(render({ statuses: [] }).sql).toContain("false");
  });
});
