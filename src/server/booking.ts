// Read-запросы флоу заявок (не server actions — обычные серверные функции).

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@db/schema";

// Заявки арендатора отдаёт getCabinetRequests в server/cabinet.ts — одной
// выборкой на обе роли, вместе с правилом раскрытия телефона.

// Телефон пользователя для предзаполнения формы заявки.
export async function getUserPhone(userId: string): Promise<string | null> {
  const rows = await getDb().select({ phone: users.phone }).from(users)
    .where(eq(users.id, userId)).limit(1);
  return rows[0]?.phone ?? null;
}
