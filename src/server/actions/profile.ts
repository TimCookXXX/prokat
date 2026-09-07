"use server";

// Профиль покупателя: имя и телефон. Телефон предзаполняет форму заявки.

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { getCityById, type City } from "@/server/catalog";
import { CITY_COOKIE, cityCookieOptions } from "@/lib/catalog/city-cookie";
import { uploads, users } from "@db/schema";
import { auth } from "@/lib/auth";
import { normalizePhone } from "@/lib/booking/validation";
import { isCoverPreset } from "@/lib/covers";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const profileSchema = z.object({
  name: z.string().trim().min(1, "Укажите имя").max(100),
  // Пустая строка = «не указан». Существование города zod проверить не может —
  // это делает запрос ниже.
  cityId: z.string().trim().max(64).optional().default(""),
  bio: z.string().trim().max(500).optional().default(""),
  // Пустая строка = убрать телефон; иначе — валидный номер.
  phone: z.string().transform((raw) => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const normalized = normalizePhone(trimmed);
    return normalized === "" ? undefined : normalized;
  }).refine((p) => p !== undefined, {
    message: "Телефон в формате +7 900 000-00-00 (или пусто)",
  }),
});

export async function updateProfile(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id || session.user.bannedAt) return { ok: false, error: "auth_required" };

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };

  // Город проверяем по базе: zod знает только форму строки, а сюда приходит
  // произвольный payload — action доступен по сети мимо формы. Отключённый
  // город тоже не берём: он не показывается нигде, и в профиле висел бы
  // ссылкой в никуда.
  let city: City | null = null;
  if (parsed.data.cityId) {
    city = await getCityById(parsed.data.cityId);
    if (!city) return { ok: false, error: "Такого города нет" };
  }

  await getDb().update(users)
    .set({
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      bio: parsed.data.bio || null,
      cityId: city?.id ?? null,
    })
    .where(eq(users.id, session.user.id));

  // Выбор города в профиле — такой же явный выбор, как в селекторе шапки, и
  // обязан быть виден сразу. Без этого кука с годовым сроком перебивала бы
  // только что сохранённый город на каждой странице.
  if (city) (await cookies()).set(CITY_COOKIE, city.slug, cityCookieOptions());

  revalidatePath("/profile");
  return { ok: true, data: undefined };
}

/* Обложка профиля. Адрес не принимаем на веру: либо это стандартный пресет из
 * белого списка, либо файл, который этот же человек загрузил через /api/upload
 * — иначе в поле можно положить что угодно, вплоть до чужой картинки с
 * трекером. null — вернуть дефолтный пресет. */
export async function updateCover(url: string | null): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "auth_required" };
  const userId = session.user.id;
  if (session.user.bannedAt) return { ok: false, error: "auth_required" };

  // Server action вызывается по сети с любым payload'ом — тип не гарантирован.
  if (url !== null && typeof url !== "string") return { ok: false, error: "unknown_image" };

  if (url !== null && !isCoverPreset(url)) {
    const rows = await getDb()
      .select({ id: uploads.id })
      .from(uploads)
      .where(and(eq(uploads.publicUrl, url), eq(uploads.userId, userId)))
      .limit(1);
    if (rows.length === 0) return { ok: false, error: "unknown_image" };
  }

  await getDb().update(users).set({ coverUrl: url }).where(eq(users.id, userId));

  // Обложка живёт в layout'ах личной зоны (виден на всех подстраницах) и на
  // публичной витрине.
  revalidatePath("/cabinet", "layout");
  revalidatePath("/profile", "layout");
  revalidatePath("/cabinet/requests", "layout");
  revalidatePath(`/u/${userId}`);
  return { ok: true, data: undefined };
}

/* Аватарка. Адрес проверяется тем же способом, что и обложка: он обязан быть
 * строкой из uploads, принадлежащей этому же человеку. Пресетов здесь нет —
 * либо своя загрузка, либо null.
 *
 * Кадрирование делает браузер, сюда приезжает уже квадрат: /api/upload с его
 * `fit: "inside"` картинку меньше 2560 не трогает. См. docs/media.md.
 *
 * Вход проверяется вручную, а не zod'ом, в отличие от updateProfile: значение
 * скалярное, схема свелась бы к тому же typeof, а расхождение с соседним
 * updateCover читалось бы как «здесь что-то иначе».
 *
 * null возвращает буквенный кружок. Для тех, кто вошёл через Яндекс или VK,
 * это необратимо: адаптер Auth.js пишет профиль только при создании
 * пользователя и на повторных входах image не обновляет — поэтому интерфейс
 * предупреждает об этом до нажатия. */
export async function updateAvatar(url: string | null): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "auth_required" };
  const userId = session.user.id;
  if (session.user.bannedAt) return { ok: false, error: "auth_required" };

  if (url !== null && typeof url !== "string") return { ok: false, error: "unknown_image" };

  if (url !== null) {
    const rows = await getDb()
      .select({ id: uploads.id })
      .from(uploads)
      .where(and(eq(uploads.publicUrl, url), eq(uploads.userId, userId)))
      .limit(1);
    if (rows.length === 0) return { ok: false, error: "unknown_image" };
  }

  await getDb().update(users).set({ image: url }).where(eq(users.id, userId));

  // Те же layout'ы, что у обложки, плюс переписка: в /chat аватарки в списке и
  // в шапке диалога — собеседника, но общий каркас личной зоны рисует и героя
  // со своей.
  //
  // Полного покрытия тут нет и быть не может: своя аватарка висит ещё на
  // карточках объявлений и в блоке владельца на страницах товара. Все они
  // force-dynamic, так что этот вызов чистит фактически клиентский Router Cache
  // того, кто менял, — остальные получат свежую на следующем запросе и так.
  revalidatePath("/cabinet", "layout");
  revalidatePath("/profile", "layout");
  revalidatePath("/cabinet/requests", "layout");
  revalidatePath("/chat", "layout");
  revalidatePath(`/u/${userId}`);
  return { ok: true, data: undefined };
}
