// Запись разобранного CSV (lib/compare/offers-csv) в rental_shops + offers.
// Всё в одной транзакции: либо файл лёг целиком, либо ничего (dryRun — всегда
// откат, но с точными счётчиками).
//
// Прокат ищется в городе по названию (без учёта регистра и пробелов) и телефону;
// телефон не мешает совпадению, если у одной из сторон он не указан. У найденного
// проката дополняются только пустые поля — данные подтверждённой карточки не
// затираются. Предложение — upsert по (прокат, класс, модель), но более старая
// проверка цены не заменяет более свежую.

import { and, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { cities, itemClasses, offers, rentalShops } from "@db/schema";
import { newId } from "@/lib/id";
import { slugify } from "@/lib/slugify";
import type { OfferRow, RowError } from "@/lib/compare/offers-csv";

export interface ImportReport {
  shopsCreated: number;
  shopsMatched: number;
  offersCreated: number;
  offersUpdated: number;
  /** Строки, чья дата проверки старше уже записанной. */
  offersSkippedStale: number;
  errors: RowError[];
  dryRun: boolean;
}

class Rollback extends Error {}

type Shop = typeof rentalShops.$inferSelect;
type Tx = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];
interface SeenShops { matched: Set<string>; created: Set<string> }

export function shopNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function importOffers(
  db: NodePgDatabase,
  rows: OfferRow[],
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<ImportReport> {
  const report: ImportReport = {
    shopsCreated: 0, shopsMatched: 0, offersCreated: 0, offersUpdated: 0,
    offersSkippedStale: 0, errors: [], dryRun,
  };
  if (rows.length === 0) return report;

  try {
    await db.transaction(async (tx) => {
      const cityRows = await tx.select({ id: cities.id, slug: cities.slug }).from(cities)
        .where(inArray(cities.slug, [...new Set(rows.map((r) => r.citySlug))]));
      const classRows = await tx.select({ id: itemClasses.id, slug: itemClasses.slug }).from(itemClasses)
        .where(inArray(itemClasses.slug, [...new Set(rows.map((r) => r.classSlug))]));
      const cityId = new Map(cityRows.map((c) => [c.slug, c.id]));
      const classId = new Map(classRows.map((c) => [c.slug, c.id]));

      for (const r of rows) {
        if (!cityId.has(r.citySlug)) report.errors.push({ line: r.line, message: `city_slug: города «${r.citySlug}» нет` });
        if (!classId.has(r.classSlug)) report.errors.push({ line: r.line, message: `class_slug: класса «${r.classSlug}» нет` });
      }
      if (report.errors.length) throw new Rollback();

      const shopsByCity = new Map<string, Shop[]>();
      const seen: SeenShops = { matched: new Set(), created: new Set() };
      for (const r of rows) {
        const cId = cityId.get(r.citySlug)!;
        if (!shopsByCity.has(cId)) {
          shopsByCity.set(cId, await tx.select().from(rentalShops).where(eq(rentalShops.cityId, cId)));
        }
        const shop = await findOrCreateShop(tx, shopsByCity.get(cId)!, cId, r, seen);
        await upsertOffer(tx, shop.id, classId.get(r.classSlug)!, r, report);
      }
      // Счётчики — по прокатам, а не по строкам файла.
      report.shopsCreated = seen.created.size;
      report.shopsMatched = seen.matched.size;

      if (dryRun) throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return report;
}

async function findOrCreateShop(
  tx: Tx, cityShops: Shop[], cityId: string, r: OfferRow, seen: SeenShops,
): Promise<Shop> {
  const key = shopNameKey(r.shopName);
  const found = cityShops.find((s) =>
    shopNameKey(s.name) === key && (!s.phone || !r.phone || s.phone === r.phone));

  if (found) {
    // Созданный этим же файлом прокат не считается ещё и «найденным».
    if (!seen.created.has(found.id)) seen.matched.add(found.id);
    const patch: Partial<Shop> = {};
    if (!found.phone && r.phone) patch.phone = r.phone;
    if (!found.district && r.district) patch.district = r.district;
    if (!found.address && r.address) patch.address = r.address;
    if (!found.website && r.website) patch.website = r.website;
    if (r.sourceUrl && !found.sourceUrls.includes(r.sourceUrl)) patch.sourceUrls = [...found.sourceUrls, r.sourceUrl];
    if (Object.keys(patch).length) {
      await tx.update(rentalShops).set({ ...patch, updatedAt: new Date() }).where(eq(rentalShops.id, found.id));
      Object.assign(found, patch);
    }
    return found;
  }

  const [created] = await tx.insert(rentalShops).values({
    id: newId(),
    cityId,
    slug: await freeShopSlug(tx, cityId, r.shopName),
    name: r.shopName,
    district: r.district,
    address: r.address,
    phone: r.phone,
    website: r.website,
    sourceUrls: r.sourceUrl ? [r.sourceUrl] : [],
  }).returning();
  seen.created.add(created.id);
  cityShops.push(created);
  return created;
}

async function freeShopSlug(tx: Tx, cityId: string, name: string): Promise<string> {
  const base = slugify(name) || "prokat";
  const taken = new Set((await tx.select({ slug: rentalShops.slug }).from(rentalShops)
    .where(and(eq(rentalShops.cityId, cityId), or(eq(rentalShops.slug, base), like(rentalShops.slug, `${base}-%`)))))
    .map((s) => s.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

async function upsertOffer(tx: Tx, shopId: string, itemClassId: string, r: OfferRow, report: ImportReport) {
  const fields = {
    priceDay: r.priceDay,
    priceWeek: r.priceWeek,
    minDays: r.minDays,
    depositRub: r.depositRub,
    depositDocument: r.depositDocument,
    deliveryAvailable: r.deliveryAvailable,
    deliveryPrice: r.deliveryPrice,
    deliveryFreeFrom: r.deliveryFreeFrom,
    deliverySameDay: r.deliverySameDay,
    verifiedAt: r.verifiedAt,
    verifiedBy: r.verifiedBy,
    sourceUrl: r.sourceUrl,
    isActive: true,
  };
  const [existing] = await tx.select({ id: offers.id, verifiedAt: offers.verifiedAt }).from(offers)
    .where(and(
      eq(offers.shopId, shopId),
      eq(offers.itemClassId, itemClassId),
      r.model === null ? isNull(offers.model) : sql`lower(${offers.model}) = lower(${r.model})`,
    ))
    .limit(1);

  if (!existing) {
    await tx.insert(offers).values({ id: newId(), shopId, itemClassId, model: r.model, ...fields });
    report.offersCreated++;
    return;
  }
  if (existing.verifiedAt > r.verifiedAt) {
    report.offersSkippedStale++;
    return;
  }
  await tx.update(offers).set({ ...fields, updatedAt: new Date() }).where(eq(offers.id, existing.id));
  report.offersUpdated++;
}
