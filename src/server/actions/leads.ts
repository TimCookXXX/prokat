"use server";

// Обращения к прокатам (lead_events) — основа метрики «доля кликов на контакт»
// и будущих отчётов прокатам. Телефон проката отдаётся только здесь, по клику:
// иначе клик не посчитать.
//
// Запись события не должна мешать человеку: если insert упал, телефон всё
// равно показываем, ошибку — в лог.

import { z } from "zod";
import { cookies, headers } from "next/headers";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cities, leadEvents, offers, regularRequests, rentalShops } from "@db/schema";
import { newId } from "@/lib/id";
import { checkLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/http/client-ip";
import { formatPhone } from "@/lib/compare/format";
import { SID_COOKIE, UTM_COOKIE, isValidSid, parseUtmCookie } from "@/lib/compare/visitor";

export type LeadResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type LeadType = (typeof leadEvents.$inferInsert)["type"];

// Параметры поиска в момент обращения: сутки и где пользователь (ТЗ, п. 2.4).
const slug = z.string().regex(/^[a-z0-9-]{1,80}$/);
const scenarioSchema = z.object({
  days: z.number().int().min(1).max(366),
  loc: z.enum(["city", "okrug", "microdistrict", "point"]),
  microdistrict: slug.optional(),
  okrug: slug.optional(),
});

const idSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "bad_id");

async function visitor() {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  const sid = jar.get(SID_COOKIE)?.value;
  return {
    sessionId: isValidSid(sid) ? sid : null,
    utm: parseUtmCookie(jar.get(UTM_COOKIE)?.value),
    ip: clientIp(h),
  };
}

/**
 * Лимит по сессии и по IP: cookie `inr_sid` задаёт сам клиент — скрипт с новой
 * cookie на каждый запрос обошёл бы лимит по сессии, но не по IP.
 */
function withinLimit(who: { sessionId: string | null; ip: string }, kind: "lead" | "lead_form"): boolean {
  const byIp = checkLimit(who.ip, kind === "lead" ? "lead_ip" : "lead_form_ip").ok;
  const bySession = who.sessionId ? checkLimit(who.sessionId, kind).ok : true;
  return byIp && bySession;
}

async function logLead(event: Omit<typeof leadEvents.$inferInsert, "id" | "createdAt">): Promise<void> {
  try {
    await getDb().insert(leadEvents).values({ id: newId(), ...event });
  } catch (e) {
    console.error(`[leads] ${event.type} insert failed:`, e);
  }
}

// ------------------------------------------------------- показать телефон

const revealSchema = z.object({
  offerId: idSchema.optional(),
  shopId: idSchema.optional(),
  tab: z.enum(["optimal", "cheapest", "nearest", "okrug"]).optional(),
  rank: z.number().int().min(1).max(1000).optional(),
  scenario: scenarioSchema.optional(),
}).refine((v) => v.offerId || v.shopId, "offer_or_shop");

/** Телефон проката по предложению (выдача) или по прокату (его страница). */
export async function revealShopPhone(input: unknown): Promise<LeadResult<{ phone: string; display: string; telegram: string | null }>> {
  const parsed = revealSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const v = parsed.data;
  const who = await visitor();
  if (!withinLimit(who, "lead")) return { ok: false, error: "rate_limited" };

  const db = getDb();
  let shop: { id: string; phone: string | null; telegram: string | null } | undefined;
  let itemClassId: string | null = null;
  let modelId: string | null = null;
  if (v.offerId) {
    const [row] = await db
      .select({ shopId: rentalShops.id, phone: rentalShops.phone, telegram: rentalShops.telegram, itemClassId: offers.itemClassId, modelId: offers.modelId })
      .from(offers)
      .innerJoin(rentalShops, eq(rentalShops.id, offers.shopId))
      .where(and(eq(offers.id, v.offerId), eq(offers.isActive, true), ne(rentalShops.status, "hidden")))
      .limit(1);
    if (row) {
      shop = { id: row.shopId, phone: row.phone, telegram: row.telegram };
      itemClassId = row.itemClassId;
      modelId = row.modelId;
    }
  } else {
    [shop] = await db.select({ id: rentalShops.id, phone: rentalShops.phone, telegram: rentalShops.telegram }).from(rentalShops)
      .where(and(eq(rentalShops.id, v.shopId!), ne(rentalShops.status, "hidden")))
      .limit(1);
  }
  if (!shop) return { ok: false, error: "not_found" };
  if (!shop.phone) return { ok: false, error: "no_phone" };

  await logLead({
    type: "show_phone",
    offerId: v.offerId ?? null,
    shopId: shop.id,
    itemClassId,
    modelId,
    sessionId: who.sessionId,
    tab: v.tab ?? null,
    rankPosition: v.rank ?? null,
    scenario: v.scenario ?? null,
    utm: who.utm,
  });
  return { ok: true, data: { phone: shop.phone, display: formatPhone(shop.phone), telegram: shop.telegram } };
}

// ----------------------------------------------- сигналы без контакта

const offerSignalSchema = z.object({ offerId: idSchema });

/** «Цена устарела?» — сигнал перепроверить цену звонком. */
export async function reportOutdatedPrice(input: unknown): Promise<LeadResult> {
  return offerSignal(input, "price_outdated");
}

async function offerSignal(input: unknown, type: LeadType): Promise<LeadResult> {
  const parsed = offerSignalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const who = await visitor();
  if (!withinLimit(who, "lead")) return { ok: false, error: "rate_limited" };
  const [row] = await getDb()
    .select({ shopId: offers.shopId, itemClassId: offers.itemClassId })
    .from(offers).where(eq(offers.id, parsed.data.offerId)).limit(1);
  if (!row) return { ok: false, error: "not_found" };
  await logLead({ type, offerId: parsed.data.offerId, shopId: row.shopId, itemClassId: row.itemClassId, sessionId: who.sessionId, utm: who.utm });
  return { ok: true, data: undefined };
}

/** Клик «Это ваш прокат?» — интерес прокатов к кабинету. */
export async function logClaimClick(input: unknown): Promise<LeadResult> {
  const parsed = z.object({ shopId: idSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const who = await visitor();
  if (!withinLimit(who, "lead")) return { ok: false, error: "rate_limited" };
  await logLead({ type: "claim_click", shopId: parsed.data.shopId, sessionId: who.sessionId, utm: who.utm });
  return { ok: true, data: undefined };
}

// ------------------------------------------------ «нужен регулярно»

const regularSchema = z.object({
  citySlug: z.string().trim().min(1).max(80),
  what: z.string().trim().min(2, "Напишите, что нужно").max(300),
  frequency: z.string().trim().max(60).optional().default(""),
  contact: z.string().trim().min(5, "Оставьте телефон или Telegram").max(120),
  itemClassId: idSchema.optional(),
  // Ловушка для ботов: поле скрыто от людей.
  website: z.string().max(0).optional().default(""),
});

export async function createRegularRequest(input: unknown): Promise<LeadResult> {
  const parsed = regularSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  const v = parsed.data;
  const who = await visitor();
  if (!withinLimit(who, "lead_form")) return { ok: false, error: "Слишком часто. Попробуйте через минуту." };

  const db = getDb();
  const [city] = await db.select({ id: cities.id }).from(cities).where(eq(cities.slug, v.citySlug)).limit(1);
  if (!city) return { ok: false, error: "invalid_input" };
  await db.insert(regularRequests).values({
    id: newId(),
    cityId: city.id,
    what: v.what,
    frequency: v.frequency || null,
    contact: v.contact,
  });
  await logLead({ type: "regular_request", itemClassId: v.itemClassId ?? null, sessionId: who.sessionId, utm: who.utm });
  return { ok: true, data: undefined };
}

// ------------------------------------------------ «не нашли — найдём»

const notFoundSchema = z.object({
  citySlug: z.string().trim().min(1).max(80),
  what: z.string().trim().min(2, "Напишите, что нужно").max(300),
  period: z.string().trim().max(60).optional().default(""),
  contact: z.string().trim().min(5, "Оставьте телефон или Telegram").max(120),
  website: z.string().max(0).optional().default(""),
});

/** Пустая выдача: «Не нашли — найдём за 30 минут» (ТЗ, п. 5.9) → заявка и событие request. */
export async function createNotFoundRequest(input: unknown): Promise<LeadResult> {
  const parsed = notFoundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  const v = parsed.data;
  const who = await visitor();
  if (!withinLimit(who, "lead_form")) return { ok: false, error: "Слишком часто. Попробуйте через минуту." };

  const db = getDb();
  const [city] = await db.select({ id: cities.id }).from(cities).where(eq(cities.slug, v.citySlug)).limit(1);
  if (!city) return { ok: false, error: "invalid_input" };
  await db.insert(regularRequests).values({
    id: newId(), cityId: city.id, kind: "not_found", what: v.what, period: v.period || null, contact: v.contact,
  });
  await logLead({ type: "request", sessionId: who.sessionId, utm: who.utm });
  return { ok: true, data: undefined };
}
