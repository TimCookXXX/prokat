import {
  pgTable, text, varchar, integer, bigint, timestamp, pgEnum, jsonb,
  boolean, date, doublePrecision, index, primaryKey, unique, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRole = pgEnum("user_role", ["user", "moderator", "admin"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  emailVerified: timestamp("email_verified"),
  username: varchar("username", { length: 20 }).unique(),
  name: varchar("name", { length: 100 }),
  // Телефон запрашивается в первой заявке на бронь и служит контактом продавца.
  // СМС-верификации нет: phone_verified_at заложен, всегда NULL.
  phone: varchar("phone", { length: 20 }),
  phoneVerifiedAt: timestamp("phone_verified_at"),
  image: text("image"),
  bio: text("bio"),
  // argon2id. NULL у OAuth-юзеров: пароль есть только у тех, кто регистрировался почтой.
  passwordHash: text("password_hash"),
  role: userRole("role").notNull().default("user"),
  // «Проверенный продавец» — ставится вручную админом (см. Фаза 6).
  isVerified: boolean("is_verified").notNull().default(false),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  banReason: text("ban_reason"),
  bannedAt: timestamp("banned_at"),
}, (t) => ({
  usernameIdx: index("users_username_idx").on(t.username),
}));

// NB: TS-keys в `accounts` намеренно mixed case (camelCase для userId/providerAccountId,
// snake_case для refresh_token/access_token/etc) — этого требует @auth/drizzle-adapter,
// он обращается к property-names напрямую.
export const accounts = pgTable("accounts", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
}, (t) => ({
  pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
}));

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires").notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.identifier, t.token] }),
}));

export const emailTokenPurpose = pgEnum("email_token_purpose", ["verify", "reset"]);

// Одноразовые ссылки из писем. В БД лежит sha256 от токена, оригинал уходит в письмо:
// дамп базы не должен давать вход в чужие аккаунты.
export const emailTokens = pgTable("email_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: emailTokenPurpose("purpose").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  // Штамп предъявления. Токены, отменённые выпуском нового письма, не штампуются,
  // а удаляются — иначе льготное окно на повторный клик оживляло бы их.
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userPurposeIdx: index("email_tokens_user_purpose_idx").on(t.userId, t.purpose),
}));

// uploads — изображения, нормализованные через /api/upload (webp) и положенные в S3.
export const uploads = pgTable("uploads", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: text("key").notNull().unique(),
  publicUrl: text("public_url").notNull(),
  mime: varchar("mime", { length: 60 }).notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("uploads_user_idx").on(t.userId, t.createdAt),
}));

// ============================== Каталог ==============================
// URL-структура публичной части: /{city}/{category}[/{sub}]/ (списки),
// /{city}/{categorySlug}/{slug}-{id}/ (карточка товара), /u/{username}/ (продавец).

export const cities = pgTable("cities", {
  id: text("id").primaryKey(),                        // ULID, newId()
  name: varchar("name", { length: 100 }).notNull(),
  // Предложный падеж для заголовков: «Прокат перфоратора в Краснодаре».
  // NULL — падеж не задан, заголовки берут name.
  namePrepositional: varchar("name_prepositional", { length: 100 }),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  region: varchar("region", { length: 100 }),
  lat: doublePrecision("lat"),
  lon: doublePrecision("lon"),
  isActive: boolean("is_active").notNull().default(true),
});

// Дерево 2 уровня: parent_id NULL = корневая категория, иначе — подкатегория.
// vertical — грубая группировка ниш (tools / sport / dresses / photo / kids ...).
export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
  parentId: text("parent_id"),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  vertical: varchar("vertical", { length: 40 }),
}, (t) => ({
  parentIdx: index("categories_parent_idx").on(t.parentId),
}));

export const depositType = pgEnum("deposit_type", ["money", "document", "none"]);
export const listingStatus = pgEnum("listing_status", ["active", "hidden", "archived"]);

// Товар принадлежит юзеру напрямую. Город и категория — атрибуты товара.
// slug читаемый и НЕ уникальный: уникальность URL даёт id в хвосте пути.
// Цены в рублях за период; NULL = не сдаётся на этот период.
export const listings = pgTable("listings", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  cityId: text("city_id").notNull().references(() => cities.id),
  categoryId: text("category_id").notNull().references(() => categories.id),
  title: varchar("title", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 80 }).notNull(),
  description: text("description"),
  location: varchar("location", { length: 120 }),   // район/ориентир выдачи, опц.
  priceDay: integer("price_day"),
  priceHour: integer("price_hour"),
  priceWeek: integer("price_week"),
  depositAmount: integer("deposit_amount"),
  depositType: depositType("deposit_type").notNull().default("none"),
  quantity: integer("quantity").notNull().default(1),
  photosJson: jsonb("photos_json").notNull().default([]),  // { url, width, height }[]
  status: listingStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  cityCategoryStatusIdx: index("listings_city_category_status_idx").on(t.cityId, t.categoryId, t.status),
  ownerIdx: index("listings_owner_idx").on(t.ownerUserId),
}));

// availability — по строке на (listing, дата). Свободно = quantity - booked - blocked.
// Строки создаются лениво: отсутствие строки = день полностью свободен.
// blocked_qty — ручные закрытия владельцем («сдал по телефону», «в ремонте»).
export const availability = pgTable("availability", {
  listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  bookedQty: integer("booked_qty").notNull().default(0),
  blockedQty: integer("blocked_qty").notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.listingId, t.date] }),
}));

export const bookingStatus = pgEnum("booking_status", [
  "new", "confirmed", "declined", "expired", "completed", "no_show", "cancelled",
]);

// Заявка на бронь. Денег сервис не проводит; подтверждение — за владельцем.
// owner_user_id денормализован из listing.owner_user_id ради индекса «входящие
// заявки владельцу» без join; владелец неизменен — рассинхрона нет.
// expires_at — протухание new-заявки (по умолчанию +24ч от created_at).
export const bookingRequests = pgTable("booking_requests", {
  id: text("id").primaryKey(),
  listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  customerUserId: text("customer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dateFrom: date("date_from").notNull(),
  dateTo: date("date_to").notNull(),
  qty: integer("qty").notNull().default(1),
  status: bookingStatus("status").notNull().default("new"),
  customerPhone: varchar("customer_phone", { length: 20 }).notNull(),
  customerComment: text("customer_comment"),
  ownerComment: text("owner_comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  respondedAt: timestamp("responded_at"),
  expiresAt: timestamp("expires_at").notNull(),
}, (t) => ({
  ownerStatusIdx: index("booking_requests_owner_status_idx").on(t.ownerUserId, t.status, t.createdAt),
  customerIdx: index("booking_requests_customer_idx").on(t.customerUserId, t.createdAt),
  listingIdx: index("booking_requests_listing_idx").on(t.listingId),
}));

// events — сырые продуктовые события (view_listing, view_phone, submit_request...).
// Основа статистики для владельца; агрегатов в v1 нет.
export const events = pgTable("events", {
  id: text("id").primaryKey(),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  entityId: text("entity_id").notNull(),
  event: varchar("event", { length: 60 }).notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  metaJson: jsonb("meta_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  entityIdx: index("events_entity_idx").on(t.entityType, t.entityId, t.createdAt),
}));

// ========================== Сравнение прокатов ==========================
// Новое ядро продукта (docs/inrenta-pivot/DATA_MODEL.md). Живёт рядом с P2P-таблицами
// и не пересекается с ними: предложение проката существует без владельца-юзера —
// его заводим мы сами из открытых данных, а прокат может подтвердить карточку позже.
// Суммы — целые рубли. Итог за даты не хранится: считается на лету (lib/compare/pricing).

// Слово в заголовке страницы — по спросу в Wordstat: «прокат перфоратора»,
// но «аренда электровелосипеда».
export const seoWord = pgEnum("seo_word", ["prokat", "arenda"]);

// Группа — страница сравнения /{city}/{slug} (/krasnodar/prokat-perforatora).
// Собирает классы, между которыми человек выбирает на одной странице
// (перфоратор SDS-plus / SDS-max). Для электровелосипедов группа = модель.
// slug делит пространство /{city}/{seg} с категориями — резолвер проверяет группы первыми.
export const itemGroups = pgTable("item_groups", {
  id: text("id").primaryKey(),
  categoryId: text("category_id").notNull().references(() => categories.id),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),                        // Перфоратор
  nameGenitive: varchar("name_genitive", { length: 120 }).notNull(),       // перфоратора
  seoWord: seoWord("seo_word").notNull().default("prokat"),
  guide: text("guide"),                                                    // справка «какой класс выбрать»
  // Синонимы для поиска: «болгарка», «ушм», «отбойник». Имя группы и классов искать и так.
  searchKeywords: text("search_keywords").array().notNull().default(sql`'{}'::text[]`),
  sort: integer("sort").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => ({
  categoryIdx: index("item_groups_category_idx").on(t.categoryId, t.sort),
}));

// Класс — единица сравнения: предложения разных прокатов ранжируются внутри класса.
// slug уникален глобально — по нему CSV-импорт находит класс.
export const itemClasses = pgTable("item_classes", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => itemGroups.id),
  slug: varchar("slug", { length: 80 }).notNull().unique(),                // perforator-sds-plus
  name: varchar("name", { length: 120 }).notNull(),                        // Перфоратор SDS-plus
  shortHint: varchar("short_hint", { length: 160 }),                       // 2–4 Дж · дюбели, штробы
  sort: integer("sort").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => ({
  groupIdx: index("item_classes_group_idx").on(t.groupId, t.sort),
}));

export const shopStatus = pgEnum("shop_status", ["unclaimed", "claimed", "hidden"]);

// Прокат. Существует без владельца: owner_user_id появляется, когда прокат
// подтвердил карточку (status=claimed). slug — для будущей страницы проката.
export const rentalShops = pgTable("rental_shops", {
  id: text("id").primaryKey(),
  cityId: text("city_id").notNull().references(() => cities.id),
  slug: varchar("slug", { length: 80 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  district: varchar("district", { length: 80 }),                           // ФМР, ЮМР…
  address: text("address"),
  phone: varchar("phone", { length: 20 }),                                 // +7XXXXXXXXXX
  telegram: varchar("telegram", { length: 100 }),
  website: text("website"),
  sourceUrls: jsonb("source_urls").$type<string[]>().notNull().default([]),
  status: shopStatus("status").notNull().default("unclaimed"),
  ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  claimedAt: timestamp("claimed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  citySlugUq: unique("rental_shops_city_slug_uq").on(t.cityId, t.slug),
  cityStatusIdx: index("rental_shops_city_status_idx").on(t.cityId, t.status),
  ownerIdx: index("rental_shops_owner_idx").on(t.ownerUserId),
}));

// Кто проверил цену: звонком, по сайту проката, по объявлению (Авито) или сам прокат.
export const claimStatus = pgEnum("claim_status", ["new", "approved", "rejected"]);

// Заявка «Это мой прокат»: человек вошёл и просит отдать ему карточку. Админ
// проверяет звонком по телефону проката и одобряет — тогда rental_shops получает
// owner_user_id и status=claimed. shop_id NULL — проката ещё нет в базе,
// тогда название — в shop_name.
export const shopClaims = pgTable("shop_claims", {
  id: text("id").primaryKey(),
  shopId: text("shop_id").references(() => rentalShops.id, { onDelete: "cascade" }),
  shopName: varchar("shop_name", { length: 200 }),
  cityId: text("city_id").notNull().references(() => cities.id),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  contactName: varchar("contact_name", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  comment: text("comment"),
  status: claimStatus("status").notNull().default("new"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  decidedAt: timestamp("decided_at"),
  decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => ({
  statusIdx: index("shop_claims_status_idx").on(t.status, t.createdAt),
  userIdx: index("shop_claims_user_idx").on(t.userId),
}));

export const verifiedBy = pgEnum("verified_by", ["call", "site", "listing", "shop"]);

// Предложение: цена и условия проката по классу. Одна строка на (прокат, класс, модель);
// модель NULL — «модель не указана», и она тоже уникальна (NULLS NOT DISTINCT).
export const offers = pgTable("offers", {
  id: text("id").primaryKey(),
  shopId: text("shop_id").notNull().references(() => rentalShops.id, { onDelete: "cascade" }),
  itemClassId: text("item_class_id").notNull().references(() => itemClasses.id),
  model: varchar("model", { length: 120 }),                                // Makita HR2470
  // Срок пользователь выбирает датами; без суточной цены оплачиваются целые недели
  // (понедельные прокаты электровелосипедов). Хотя бы одна из цен есть всегда.
  priceDay: integer("price_day"),
  priceWeek: integer("price_week"),                                        // за 7 суток, если есть тариф
  minDays: integer("min_days").notNull().default(1),                       // минимальный оплачиваемый срок
  // NULL — залог неизвестен («уточняется»), 0 — денежного залога нет.
  depositRub: integer("deposit_rub"),
  depositDocument: boolean("deposit_document").notNull().default(false),   // паспорт в залог
  deliveryAvailable: boolean("delivery_available").notNull().default(false),
  deliveryPrice: integer("delivery_price").notNull().default(0),
  deliveryFreeFrom: integer("delivery_free_from"),                         // бесплатно от суммы аренды
  deliverySameDay: boolean("delivery_same_day").notNull().default(false),
  // Дата проверки цены. Старше 30 дней — предложение уходит из рейтинга
  // в блок «на перепроверке».
  verifiedAt: date("verified_at").notNull(),
  verifiedBy: verifiedBy("verified_by").notNull().default("call"),
  sourceUrl: text("source_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  shopClassModelUq: unique("offers_shop_class_model_uq").on(t.shopId, t.itemClassId, t.model).nullsNotDistinct(),
  hasPrice: check("offers_has_price", sql`${t.priceDay} IS NOT NULL OR ${t.priceWeek} IS NOT NULL`),
  classIdx: index("offers_class_idx").on(t.itemClassId, t.isActive),
  shopIdx: index("offers_shop_idx").on(t.shopId),
}));

export const leadType = pgEnum("lead_type", [
  "show_phone", "call", "request", "regular_request", "price_outdated", "claim_click",
]);

// Обращения и сигналы: из них — метрика «доля кликов на контакт» и отчёты прокатам.
// session_id — анонимный id посетителя из cookie; вкладка и место в выдаче —
// чтобы понимать, что именно человек сравнивал.
export const leadEvents = pgTable("lead_events", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  type: leadType("type").notNull(),
  offerId: text("offer_id").references(() => offers.id, { onDelete: "set null" }),
  shopId: text("shop_id").references(() => rentalShops.id, { onDelete: "set null" }),
  itemClassId: text("item_class_id").references(() => itemClasses.id, { onDelete: "set null" }),
  sessionId: varchar("session_id", { length: 64 }),
  tab: varchar("tab", { length: 20 }),                                     // cheapest | noMoneyDeposit | sameDay
  rankPosition: integer("rank_position"),
  scenario: jsonb("scenario").$type<{ days: number; needDelivery: boolean; district?: string }>(),
  utm: jsonb("utm").$type<Record<string, string>>(),
}, (t) => ({
  shopIdx: index("lead_events_shop_idx").on(t.shopId, t.createdAt),
  classIdx: index("lead_events_class_idx").on(t.itemClassId, t.createdAt),
  typeIdx: index("lead_events_type_idx").on(t.type, t.createdAt),
}));

export const regularRequestStatus = pgEnum("regular_request_status", ["new", "sent", "closed"]);

// Заявки «нужен регулярно» — проверка гипотезы о повторных арендаторах.
export const regularRequests = pgTable("regular_requests", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  cityId: text("city_id").notNull().references(() => cities.id),
  what: text("what").notNull(),
  frequency: varchar("frequency", { length: 60 }),
  contact: varchar("contact", { length: 120 }).notNull(),
  status: regularRequestStatus("status").notNull().default("new"),
});
