// Черновик Drizzle-схемы для модели «сравнение прокатов».
// Новые таблицы — рядом со старыми, старые (объявления, календарь, заявки) не трогаем.
// Перед применением:
//  1) сверить формат id с проектом (в users.id сейчас смешаны ULID и UUID — выбрать один для новых таблиц);
//  2) раскомментировать ссылку на users и импорт;
//  3) сверить city/category с уже существующими справочниками, если они есть.
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// import { users } from "./schema";

export const shopStatus = pgEnum("shop_status", ["unclaimed", "claimed", "hidden"]);
export const verifiedBy = pgEnum("verified_by", ["call", "site", "listing", "shop"]);
export const leadType = pgEnum("lead_type", [
  "show_phone",
  "call",
  "request",
  "regular_request",
  "price_outdated",
  "claim_click",
]);
export const seoWord = pgEnum("seo_word", ["prokat", "arenda"]);

/** Класс предмета, по которому сравниваем: «Перфоратор SDS-plus до 4 Дж». */
export const itemClass = pgTable(
  "item_class",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categorySlug: text("category_slug").notNull(), // tools, ebikes, ...
    slug: text("slug").notNull(), // perforator-sds-plus
    name: text("name").notNull(), // Перфоратор SDS-plus
    shortHint: text("short_hint"), // до 4 Дж · дюбели, штробы
    groupSlug: text("group_slug"), // perforator — для объединения подклассов на одной странице
    seoWord: seoWord("seo_word").notNull().default("prokat"),
    sort: integer("sort").notNull().default(0),
  },
  (t) => ({ slugUq: uniqueIndex("item_class_slug_uq").on(t.categorySlug, t.slug) }),
);

/** Прокат как сущность. Существует без владельца, пока не подтвердил карточку. */
export const rentalShop = pgTable(
  "rental_shop",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    citySlug: text("city_slug").notNull(), // krasnodar
    name: text("name").notNull(),
    district: text("district"), // ФМР, ЮМР, ...
    address: text("address"),
    phone: text("phone"),
    telegram: text("telegram"),
    website: text("website"),
    sourceUrls: jsonb("source_urls").$type<string[]>().notNull().default([]),
    status: shopStatus("status").notNull().default("unclaimed"),
    ownerUserId: text("owner_user_id"), // .references(() => users.id)
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ cityIdx: index("rental_shop_city_idx").on(t.citySlug, t.status) }),
);

/** Предложение проката по классу предмета. */
export const offer = pgTable(
  "offer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id").notNull().references(() => rentalShop.id, { onDelete: "cascade" }),
    itemClassId: uuid("item_class_id").notNull().references(() => itemClass.id),
    model: text("model"), // Makita HR2470
    priceDay: integer("price_day").notNull(), // ₽
    priceWeek: integer("price_week"), // ₽ за 7 суток, если есть
    minDays: integer("min_days").notNull().default(1),
    depositRub: integer("deposit_rub"), // null — неизвестен («уточняется»), 0 — денежного нет
    depositDocument: boolean("deposit_document").notNull().default(false),
    deliveryAvailable: boolean("delivery_available").notNull().default(false),
    deliveryPrice: integer("delivery_price").notNull().default(0),
    deliveryFreeFrom: integer("delivery_free_from"),
    deliverySameDay: boolean("delivery_same_day").notNull().default(false),
    verifiedAt: date("verified_at", { mode: "date" }).notNull(),
    verifiedBy: verifiedBy("verified_by").notNull().default("call"),
    sourceUrl: text("source_url"),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    classIdx: index("offer_class_idx").on(t.itemClassId, t.isActive),
    shopIdx: index("offer_shop_idx").on(t.shopId),
  }),
);

/** Обращения: из них — метрика «доля кликов на контакт» и ежемесячные отчёты прокатам. */
export const leadEvent = pgTable(
  "lead_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    type: leadType("type").notNull(),
    offerId: uuid("offer_id").references(() => offer.id, { onDelete: "set null" }),
    shopId: uuid("shop_id").references(() => rentalShop.id, { onDelete: "set null" }),
    itemClassId: uuid("item_class_id").references(() => itemClass.id),
    sessionId: text("session_id"), // анонимный id посетителя из cookie
    tab: text("tab"), // cheapest | noMoneyDeposit | sameDay
    rankPosition: integer("rank_position"), // на каком месте было предложение
    scenario: jsonb("scenario").$type<{ days: number; needDelivery: boolean; district?: string }>(),
    utm: jsonb("utm").$type<Record<string, string>>(),
  },
  (t) => ({
    shopMonthIdx: index("lead_event_shop_idx").on(t.shopId, t.createdAt),
    classIdx: index("lead_event_class_idx").on(t.itemClassId, t.createdAt),
  }),
);

/** Заявки «инструмент нужен регулярно» — для проверки гипотезы о повторных клиентах. */
export const regularRequest = pgTable("regular_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  citySlug: text("city_slug").notNull(),
  what: text("what").notNull(),
  frequency: text("frequency"),
  contact: text("contact").notNull(),
  status: text("status").notNull().default("new"), // new | sent | closed
});
