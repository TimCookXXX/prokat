import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site-config";
import {
  getActiveCities, getAllActiveListingPaths, getAllCategories,
  getListingCountsByCategory, rollupToRoots,
} from "@/server/catalog";
import { listingPath } from "@/lib/catalog/listing-path";
import { isP2PEnabled } from "@/lib/features";
import { getGroupsWithOffers } from "@/server/compare";
import { getCityShops } from "@/server/shops";
import { SHOPS_SEGMENT } from "@/lib/compare/catalog-data";
import { getDb } from "@/lib/db";
import { categories, itemGroups } from "@db/schema";
import { eq } from "drizzle-orm";

// Sitemap читает БД в рантайме; force-dynamic — иначе Next prerender'ит
// во время build без БД и падает.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteConfig.url;
  const out: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1.0 },
    { url: `${base}/kak-schitaem-ceny`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/dlya-prokatov`, changeFrequency: "monthly", priority: 0.4 },
  ];

  // Сравнение: города, категории и группы с ценами, прокаты. Пустые группы
  // («цены собираем») в индекс не отдаём.
  const groups = await getGroupsWithOffers();
  const groupCategory = new Map((await getDb()
    .select({ group: itemGroups.slug, category: categories.slug })
    .from(itemGroups).innerJoin(categories, eq(categories.id, itemGroups.categoryId)))
    .map((r) => [r.group, r.category]));
  for (const city of await getActiveCities()) {
    const cityGroups = groups.filter((g) => g.citySlug === city.slug);
    if (cityGroups.length === 0) continue;
    out.push({ url: `${base}/${city.slug}`, changeFrequency: "daily", priority: 0.9 });
    for (const cat of new Set(cityGroups.map((g) => groupCategory.get(g.groupSlug)).filter(Boolean))) {
      out.push({ url: `${base}/${city.slug}/${cat}`, changeFrequency: "weekly", priority: 0.7 });
    }
    for (const g of cityGroups) {
      out.push({ url: `${base}/${city.slug}/${g.groupSlug}`, changeFrequency: "daily", priority: 0.9 });
    }
    out.push({ url: `${base}/${city.slug}/${SHOPS_SEGMENT}`, changeFrequency: "weekly", priority: 0.5 });
    for (const shop of await getCityShops(city.id)) {
      if (shop.offers > 0) out.push({ url: `${base}/${city.slug}/${SHOPS_SEGMENT}/${shop.slug}`, changeFrequency: "weekly", priority: 0.5 });
    }
  }

  // Ниже — выдача объявлений P2P-контура.
  if (!isP2PEnabled()) return out;

  const [citiesList, cats] = await Promise.all([getActiveCities(), getAllCategories()]);

  for (const city of citiesList) {
    const direct = await getListingCountsByCategory(city.id);
    const rootCounts = rollupToRoots(cats, direct);

    // Корневые категории — главные SEO-страницы; пустые в sitemap не попадают.
    for (const cat of cats.filter((c) => c.parentId === null)) {
      if ((rootCounts.get(cat.id) ?? 0) === 0) continue;
      out.push({
        url: `${base}/${city.slug}/${cat.slug}`,
        changeFrequency: "daily",
        priority: 0.8,
      });
    }

    // Подкатегории существуют только с ≥1 активной позицией.
    for (const sub of cats.filter((c) => c.parentId !== null)) {
      if ((direct.get(sub.id) ?? 0) === 0) continue;
      const root = cats.find((c) => c.id === sub.parentId);
      if (!root) continue;
      out.push({
        url: `${base}/${city.slug}/${root.slug}/${sub.slug}`,
        changeFrequency: "daily",
        priority: 0.7,
      });
    }
  }

  for (const l of await getAllActiveListingPaths()) {
    out.push({
      url: `${base}${listingPath(l.citySlug, l.categorySlug, l.listingSlug, l.listingId)}`,
      lastModified: l.updatedAt,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  return out;
}
