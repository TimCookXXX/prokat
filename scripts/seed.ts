// Dev/staging seeds. Идемпотентен, части независимы:
// 1) справочник сравнения — Краснодар, категории, группы, классы (syncCatalog);
// 2) демо-прокаты и цены — только вне production, через тот же импорт, что CSV;
// 3) демо P2P-контура (FEATURE_P2P) — 5 владельцев и 20 товаров в Краснодаре;
//    пропускается, если владельцы уже есть.
// Запуск: pnpm db:seed (нужен DATABASE_URL в .env, миграции применены).

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, isNull, like, sql } from "drizzle-orm";
import { Pool } from "pg";
import {
  users, cities, categories, listings, availability,
} from "../drizzle/schema";
import { syncCatalog } from "../src/server/compare/catalog-sync";
import { importOffers } from "../src/server/compare/import-offers";
import { DEFAULT_CITY_SLUG } from "../src/lib/compare/catalog-data";
import { demoOfferRows } from "./seed-demo-offers";
import { newId } from "../src/lib/id";
import { slugify } from "../src/lib/slugify";
import { addDaysStr, todayStr } from "../src/lib/catalog/dates";
import { DEV_SEED_PASSWORD, devSeedPassword } from "../src/lib/auth/password";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  // Пароли раздаются и до проверки идемпотентности (на уже засеянной базе P2P-часть
  // пропускается), и после создания владельцев — чтобы вход работал с первого запуска.
  const grantDevPasswords = async () => {
    const seedHash = await devSeedPassword(process.env.NODE_ENV);
    if (!seedHash) return;
    const updated = await db.update(users)
      .set({ passwordHash: seedHash, emailVerified: new Date() })
      .where(and(like(users.email, "%@seed.local"), isNull(users.passwordHash)))
      .returning({ id: users.id });
    if (updated.length > 0) {
      console.log(`Seed owners got a dev password (${updated.length}): ${DEV_SEED_PASSWORD}`);
    }
  };
  await grantDevPasswords();

  // --- 1. Справочник сравнения ---
  const catalog = await syncCatalog(db);
  console.log(`Catalog: ${catalog.groupsUpserted} groups, ${catalog.classesUpserted} classes, ${catalog.districtsUpserted} places, ${catalog.modelsUpserted} models`);
  const [city] = await db.select({ id: cities.id }).from(cities).where(eq(cities.slug, DEFAULT_CITY_SLUG)).limit(1);
  const cityId = city.id;

  // --- 2. Демо-прокаты и цены ---
  if (process.env.NODE_ENV !== "production") {
    const demo = await importOffers(db, demoOfferRows(todayStr()));
    if (demo.errors.length) throw new Error(`Demo offers: ${demo.errors.map((e) => e.message).join("; ")}`);
    console.log(
      `Demo offers: ${demo.shopsCreated} shops created, ` +
      `${demo.offersCreated} offers created, ${demo.offersUpdated} updated`,
    );
  }

  // --- 3. Демо P2P-контура ---
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, "owner1@seed.local")).limit(1);
  if (existing.length > 0) {
    console.log("P2P demo already applied (seed owners exist), skipping");
    await pool.end();
    return;
  }

  // Категории (дерево 2 уровня). Справочник общий со сравнением — корневая
  // «Инструменты» уже может быть создана syncCatalog, поэтому find-or-create.
  const cat = async (
    name: string, vertical: string, parentId: string | null = null, slug?: string,
  ) => {
    const s = slug ?? slugify(name);
    const [found] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, s)).limit(1);
    if (found) return found.id;
    const id = newId();
    await db.insert(categories).values({ id, parentId, name, slug: s, vertical });
    return id;
  };

  // Инструменты
  const toolsId = await cat("Инструменты", "tools");
  const powerToolsId = await cat("Электроинструменты", "tools", toolsId);
  await cat("Ручной инструмент", "tools", toolsId);
  const gardenId = await cat("Садовая техника", "tools", toolsId);
  await cat("Строительное оборудование", "tools", toolsId);

  // Одежда
  const clothesId = await cat("Одежда", "clothing");
  const eveningId = await cat("Вечерняя одежда", "clothing", clothesId);
  const weddingId = await cat("Свадебная одежда", "clothing", clothesId);
  await cat("Костюмы", "clothing", clothesId);
  await cat("Аксессуары", "clothing", clothesId, "aksessuary-odezhda");

  // Фото и видео
  const photoId = await cat("Фото и видео", "photo");
  await cat("Камеры", "photo", photoId);
  await cat("Объективы", "photo", photoId);
  await cat("Освещение", "photo", photoId);
  await cat("Штативы и стабилизаторы", "photo", photoId);
  await cat("Дроны", "photo", photoId);
  await cat("Экшн-камеры", "photo", photoId);

  // Транспорт
  const transportId = await cat("Транспорт", "transport");
  const bikesId = await cat("Велосипеды", "transport", transportId);
  const scootersId = await cat("Электросамокаты", "transport", transportId);
  await cat("Автомобили", "transport", transportId);
  await cat("Прицепы", "transport", transportId);
  await cat("Водный транспорт", "transport", transportId);

  // Туризм и отдых
  const outdoorId = await cat("Туризм и отдых", "outdoor");
  await cat("Палатки", "outdoor", outdoorId);
  await cat("Спальники", "outdoor", outdoorId);
  await cat("Рюкзаки", "outdoor", outdoorId);
  await cat("Кемпинг-оборудование", "outdoor", outdoorId);
  await cat("Туристическая посуда", "outdoor", outdoorId);

  // Развлечения
  const funId = await cat("Развлечения", "entertainment");
  await cat("Игровые приставки", "entertainment", funId);
  await cat("VR", "entertainment", funId);
  await cat("Настольные игры", "entertainment", funId);
  await cat("Проекторы", "entertainment", funId);

  // Детские товары
  const kidsId = await cat("Детские товары", "kids");
  await cat("Коляски", "kids", kidsId);
  await cat("Автокресла", "kids", kidsId);
  await cat("Игрушки", "kids", kidsId);
  await cat("Стульчики для кормления", "kids", kidsId);

  // Дом и мероприятия
  const homeId = await cat("Дом и мероприятия", "home");
  await cat("Мебель", "home", homeId);
  await cat("Декор", "home", homeId);
  await cat("Шатры и тенты", "home", homeId);
  await cat("Грили и барбекю", "home", homeId);
  await cat("Уборочная техника", "home", homeId);

  // Электроника
  const electronicsId = await cat("Электроника", "electronics");
  await cat("Ноутбуки", "electronics", electronicsId);
  await cat("Планшеты", "electronics", electronicsId);
  await cat("Смартфоны", "electronics", electronicsId);
  await cat("Мониторы", "electronics", electronicsId);
  await cat("Аксессуары", "electronics", electronicsId, "aksessuary-elektronika");

  // Спорт
  const sportId = await cat("Спорт", "sport");
  await cat("Тренажеры", "sport", sportId);
  await cat("Фитнес-инвентарь", "sport", sportId);
  await cat("Зимний спорт", "sport", sportId);
  await cat("Велоспорт", "sport", sportId);
  const waterSportId = await cat("Водный спорт", "sport", sportId);

  // --- Юзеры-владельцы (телефон = контакт продавца) ---
  const ownerDefs = [
    { username: "prokatmaster", name: "Артём", phone: "+7 900 111-22-33" },
    { username: "instrument116", name: "Роман", phone: "+7 900 222-33-44" },
    { username: "velokrd", name: "Дмитрий", phone: "+7 900 333-44-55" },
    { username: "sup-kuban", name: "Игорь", phone: "+7 900 444-55-66" },
    { username: "platye-naprokat", name: "Марина", phone: "+7 900 555-66-77" },
  ];

  const ownerIds: string[] = [];
  for (let i = 0; i < ownerDefs.length; i++) {
    const def = ownerDefs[i];
    const userId = newId();
    await db.insert(users).values({
      id: userId,
      email: `owner${i + 1}@seed.local`,
      username: def.username,
      name: def.name,
      phone: def.phone,
      isVerified: i < 2, // пара «проверенных» для демо значка
      verifiedAt: i < 2 ? new Date() : null,
    });
    ownerIds.push(userId);
  }

  // --- Товары: [владелец, категория, название, цена/день, залог(₽|null), тип залога, кол-во] ---
  const listingDefs: Array<[number, string, string, number, number | null, "money" | "document" | "none", number]> = [
    [0, powerToolsId, "Перфоратор Bosch GBH 2-26", 500, 3000, "money", 3],
    [0, powerToolsId, "Шуруповёрт Makita DF333", 300, 2000, "money", 5],
    [0, powerToolsId, "Болгарка DeWalt 125 мм", 350, 2500, "money", 2],
    [0, gardenId, "Газонокосилка бензиновая Husqvarna", 900, 5000, "money", 2],
    [0, gardenId, "Триммер электрический", 400, 2000, "money", 3],
    [1, powerToolsId, "Отбойный молоток Hilti TE 500", 1200, 8000, "money", 1],
    [1, powerToolsId, "Сварочный аппарат Ресанта 190А", 600, 4000, "money", 2],
    [1, gardenId, "Мотобур со шнеками 150/200 мм", 1000, 5000, "money", 1],
    [1, powerToolsId, "Строительный пылесос Karcher", 500, 3000, "money", 2],
    [2, bikesId, "Горный велосипед Trek Marlin 7", 700, null, "document", 6],
    [2, bikesId, "Городской велосипед Forward", 450, null, "document", 8],
    [2, bikesId, "Детский велосипед 20\"", 300, null, "document", 4],
    [2, scootersId, "Электросамокат Ninebot Max", 900, 5000, "money", 5],
    [3, waterSportId, "Сапборд Aztron Mercury 10'10\"", 800, 3000, "money", 10],
    [3, waterSportId, "Сапборд двухместный 15'", 1400, 5000, "money", 2],
    [3, waterSportId, "Гидрокостюм 3 мм", 300, null, "document", 8],
    [4, eveningId, "Вечернее платье Zara, р. 42-44", 1500, 5000, "money", 1],
    [4, eveningId, "Коктейльное платье, р. 46", 1200, 4000, "money", 1],
    [4, weddingId, "Свадебное платье А-силуэт", 5000, 15000, "money", 1],
    [4, eveningId, "Платье для фотосессии со шлейфом", 2000, 6000, "money", 1],
  ];

  const listingIds: string[] = [];
  for (const [oIdx, categoryId, title, priceDay, depositAmount, depositType, quantity] of listingDefs) {
    const id = newId();
    // Демо-фото: 3 локальные картинки из public/demo/ (циклом), без внешних хостов.
    const base = listingIds.length % 6;
    const photos = [0, 1, 2].map((k) => `/demo/${((base + k) % 6) + 1}.webp`);
    listingIds.push(id);
    await db.insert(listings).values({
      id,
      ownerUserId: ownerIds[oIdx],
      cityId,
      categoryId,
      title,
      slug: slugify(title),
      description: `${title}. Тестовый товар из сидов.`,
      priceDay,
      priceWeek: priceDay * 5, // недельная скидка ~30%
      depositAmount,
      depositType,
      quantity,
      photosJson: photos.map((url) => ({ url, width: 800, height: 600 })),
      status: "active",
    });
  }

  // Демо-занятость: у каждого третьего товара заняты ближайшие дни,
  // у каждого пятого — ручное закрытие. Календари в UI сразу «живые».
  const today = todayStr();
  let availRows = 0;
  for (let i = 0; i < listingIds.length; i++) {
    const quantity = listingDefs[i][6];
    if (i % 3 === 0) {
      for (let d = 1; d <= 3; d++) {
        await db.insert(availability).values({
          listingId: listingIds[i],
          date: addDaysStr(today, d),
          bookedQty: Math.min(quantity, i % 2 === 0 ? quantity : 1), // часть — полностью занята
        });
        availRows++;
      }
    }
    if (i % 5 === 0) {
      for (let d = 7; d <= 8; d++) {
        await db.insert(availability).values({
          listingId: listingIds[i],
          date: addDaysStr(today, d),
          blockedQty: quantity, // «в ремонте» / «сдал по телефону»
        });
        availRows++;
      }
    }
  }

  await grantDevPasswords();
  const catCount = (await db.select({ c: sql<number>`count(*)::int` }).from(categories))[0].c;
  await pool.end();
  console.log(`P2P demo: ${catCount} categories, ${ownerDefs.length} owners, ${listingDefs.length} listings, ${availRows} availability rows`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
