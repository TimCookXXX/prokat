"use server";

// Прокаты: заявка «Это мой прокат», цены в кабинете владельца, модерация карточек.
//
// Владелец правит только свои предложения; любое сохранение ставит
// verified_at = сегодня и verified_by = shop — цену подтвердил сам прокат.

import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { cities, itemClasses, offers, regularRequests, rentalShops, shopClaims } from "@db/schema";
import { auth } from "@/lib/auth";
import { newId } from "@/lib/id";
import { slugify } from "@/lib/slugify";
import { checkLimit } from "@/lib/rate-limit";
import { normalizePhone } from "@/lib/compare/offers-csv";
import { localToday } from "@/lib/compare/scenario";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function currentUser(): Promise<{ id: string; role: string } | null> {
  const session = await auth();
  if (!session?.user?.id || session.user.bannedAt) return null;
  return { id: session.user.id, role: session.user.role };
}

// ------------------------------------------------ «Это мой прокат»

const claimSchema = z.object({
  citySlug: z.string().trim().min(1).max(80),
  shopId: z.string().trim().max(40).optional().default(""),
  shopName: z.string().trim().max(200).optional().default(""),
  contactName: z.string().trim().min(2, "Как к вам обращаться").max(100),
  phone: z.string().trim().min(1, "Телефон для проверки звонком").max(30),
  comment: z.string().trim().max(1000).optional().default(""),
});

export async function submitShopClaim(input: unknown): Promise<ActionResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "auth_required" };
  const parsed = claimSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  const v = parsed.data;
  const phone = normalizePhone(v.phone);
  if (!phone) return { ok: false, error: "Телефон в формате +7 900 000-00-00" };
  if (!v.shopId && v.shopName.length < 2) return { ok: false, error: "Выберите прокат или напишите название" };
  if (!checkLimit(user.id, "lead_form").ok) return { ok: false, error: "Слишком часто. Попробуйте через минуту." };

  const db = getDb();
  const [city] = await db.select({ id: cities.id }).from(cities).where(eq(cities.slug, v.citySlug)).limit(1);
  if (!city) return { ok: false, error: "invalid_input" };
  if (v.shopId) {
    const [shop] = await db.select({ status: rentalShops.status, cityId: rentalShops.cityId }).from(rentalShops)
      .where(eq(rentalShops.id, v.shopId)).limit(1);
    if (!shop || shop.cityId !== city.id) return { ok: false, error: "not_found" };
    if (shop.status === "claimed") return { ok: false, error: "Эту карточку уже подтвердил прокат" };
    const [open] = await db.select({ id: shopClaims.id }).from(shopClaims)
      .where(and(eq(shopClaims.shopId, v.shopId), eq(shopClaims.userId, user.id), eq(shopClaims.status, "new"))).limit(1);
    if (open) return { ok: false, error: "Заявка уже отправлена — мы позвоним" };
  }

  await db.insert(shopClaims).values({
    id: newId(),
    shopId: v.shopId || null,
    shopName: v.shopId ? null : v.shopName,
    cityId: city.id,
    userId: user.id,
    contactName: v.contactName,
    phone,
    comment: v.comment || null,
  });
  revalidatePath("/dlya-prokatov");
  return { ok: true, data: undefined };
}

// ------------------------------------------------ цены владельца

const money = z.number().int().min(0).max(10_000_000);
const offerFields = z.object({
  priceDay: money.min(1).nullable(),
  priceWeek: money.min(1).nullable(),
  minDays: z.number().int().min(1).max(365),
  depositRub: money.nullable(),
  depositDocument: z.boolean(),
  deliveryAvailable: z.boolean(),
  deliveryPrice: money,
  deliveryFreeFrom: money.min(1).nullable(),
  deliverySameDay: z.boolean(),
}).refine((o) => o.priceDay !== null || o.priceWeek !== null, "Нужна цена за сутки или за неделю");

const updateSchema = z.array(offerFields.and(z.object({ id: z.string().min(1).max(40), isActive: z.boolean() }))).max(200);

async function ownShop(userId: string, shopId: string) {
  const [shop] = await getDb().select({ id: rentalShops.id }).from(rentalShops)
    .where(and(eq(rentalShops.id, shopId), eq(rentalShops.ownerUserId, userId), eq(rentalShops.status, "claimed")))
    .limit(1);
  return shop ?? null;
}

// Доставки нет — её условия не храним, чтобы они не всплыли при включении.
function normalizeDelivery<T extends z.infer<typeof offerFields>>(o: T): T {
  return o.deliveryAvailable ? o : { ...o, deliveryPrice: 0, deliveryFreeFrom: null, deliverySameDay: false };
}

export async function updateShopOffers(shopId: string, input: unknown): Promise<ActionResult<{ updated: number }>> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "auth_required" };
  if (!(await ownShop(user.id, shopId))) return { ok: false, error: "forbidden" };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };

  const rows = parsed.data;
  const today = localToday();
  const db = getDb();
  const updated = await db.transaction(async (tx) => {
    const own = new Set((await tx.select({ id: offers.id }).from(offers)
      .where(and(eq(offers.shopId, shopId), inArray(offers.id, rows.map((r) => r.id).concat(["-"])))))
      .map((r) => r.id));
    let n = 0;
    for (const { id, ...fields } of rows) {
      if (!own.has(id)) continue;
      await tx.update(offers)
        .set({ ...normalizeDelivery(fields), verifiedAt: today, verifiedBy: "shop", updatedAt: new Date() })
        .where(eq(offers.id, id));
      n++;
    }
    return n;
  });
  revalidatePath("/moy-prokat");
  return { ok: true, data: { updated } };
}

const addSchema = offerFields.and(z.object({
  classSlug: z.string().trim().min(1).max(80),
  model: z.string().trim().max(120).optional().default(""),
}));

export async function addShopOffer(shopId: string, input: unknown): Promise<ActionResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "auth_required" };
  if (!(await ownShop(user.id, shopId))) return { ok: false, error: "forbidden" };
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  const { classSlug, model, ...fields } = parsed.data;

  const db = getDb();
  const [cls] = await db.select({ id: itemClasses.id }).from(itemClasses).where(eq(itemClasses.slug, classSlug)).limit(1);
  if (!cls) return { ok: false, error: "Нет такого класса" };
  const inserted = await db.insert(offers).values({
    id: newId(),
    shopId,
    itemClassId: cls.id,
    model: model || null,
    ...normalizeDelivery(fields),
    verifiedAt: localToday(),
    verifiedBy: "shop",
  }).onConflictDoNothing().returning({ id: offers.id });
  if (inserted.length === 0) return { ok: false, error: "Такая модель в этом классе уже есть" };
  revalidatePath("/moy-prokat");
  return { ok: true, data: undefined };
}

// ------------------------------------------------ модерация (admin)

async function requireAdmin(): Promise<string | null> {
  const user = await currentUser();
  return user?.role === "admin" ? user.id : null;
}

/** Одобрить заявку: прокат становится подтверждённым, владелец — автор заявки. */
export async function adminApproveClaim(claimId: string): Promise<ActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false, error: "forbidden" };
  const db = getDb();
  const res = await db.transaction(async (tx) => {
    const [claim] = await tx.select().from(shopClaims).where(eq(shopClaims.id, claimId)).limit(1);
    if (!claim || claim.status !== "new") return "not_found";
    let shopId = claim.shopId;
    if (shopId) {
      const [shop] = await tx.select({ status: rentalShops.status }).from(rentalShops).where(eq(rentalShops.id, shopId)).limit(1);
      if (!shop) return "not_found";
      if (shop.status === "claimed") return "Карточку уже подтвердил другой владелец";
      await tx.update(rentalShops)
        .set({ status: "claimed", ownerUserId: claim.userId, claimedAt: new Date(), updatedAt: new Date() })
        .where(eq(rentalShops.id, shopId));
    } else {
      // Проката не было в базе — заводим карточку по заявке.
      const name = claim.shopName ?? claim.contactName;
      const base = slugify(name) || "prokat";
      const taken = new Set((await tx.select({ slug: rentalShops.slug }).from(rentalShops)
        .where(eq(rentalShops.cityId, claim.cityId))).map((s) => s.slug));
      let slug = base;
      for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
      shopId = newId();
      await tx.insert(rentalShops).values({
        id: shopId, cityId: claim.cityId, slug, name, phone: claim.phone,
        status: "claimed", ownerUserId: claim.userId, claimedAt: new Date(),
      });
    }
    await tx.update(shopClaims)
      .set({ status: "approved", shopId, decidedAt: new Date(), decidedBy: adminId })
      .where(eq(shopClaims.id, claimId));
    return null;
  });
  if (res) return { ok: false, error: res };
  revalidatePath("/admin/shops");
  return { ok: true, data: undefined };
}

export async function adminRejectClaim(claimId: string): Promise<ActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false, error: "forbidden" };
  const res = await getDb().update(shopClaims)
    .set({ status: "rejected", decidedAt: new Date(), decidedBy: adminId })
    .where(and(eq(shopClaims.id, claimId), eq(shopClaims.status, "new")))
    .returning({ id: shopClaims.id });
  if (res.length === 0) return { ok: false, error: "not_found" };
  revalidatePath("/admin/shops");
  return { ok: true, data: undefined };
}

/** Скрыть прокат из выдачи (закрылся, дубль) или вернуть. */
export async function adminSetShopHidden(shopId: string, hidden: boolean): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "forbidden" };
  const db = getDb();
  const [shop] = await db.select({ ownerUserId: rentalShops.ownerUserId }).from(rentalShops).where(eq(rentalShops.id, shopId)).limit(1);
  if (!shop) return { ok: false, error: "not_found" };
  await db.update(rentalShops)
    .set({ status: hidden ? "hidden" : shop.ownerUserId ? "claimed" : "unclaimed", updatedAt: new Date() })
    .where(eq(rentalShops.id, shopId));
  revalidatePath("/admin/shops");
  return { ok: true, data: undefined };
}

export async function adminSetRegularRequestStatus(id: string, status: "new" | "sent" | "closed"): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "forbidden" };
  const res = await getDb().update(regularRequests).set({ status }).where(eq(regularRequests.id, id)).returning({ id: regularRequests.id });
  if (res.length === 0) return { ok: false, error: "not_found" };
  revalidatePath("/admin/regular");
  return { ok: true, data: undefined };
}
