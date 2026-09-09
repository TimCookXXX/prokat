// Заведение дерева категорий. Общее для обоих сидов: справочник один, а
// наполнять базу можно и демо-данными (scripts/seed.ts), и реальными
// (scripts/seed-real.ts), в любом порядке и по отдельности.
//
// Идемпотентно и по слагу, а не по имени: слаг — то, что стоит в адресе
// каталога, и именно он должен остаться прежним, если категорию переименуют.

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { categories } from "../drizzle/schema";
import { newId } from "../src/lib/id";
import { slugify } from "../src/lib/slugify";
import { SEED_CATEGORIES, categoryPath } from "../src/lib/seed/categories";

/** Минимум, который нужен от db: подходит и пул, и транзакция. */
export type SeedDb = Pick<NodePgDatabase, "select" | "insert" | "update">;

/**
 * Создаёт недостающие категории и возвращает карту «Корень / Подкатегория» →
 * id подкатегории. Существующие не трогает: в базе могли завестись категории
 * помимо дерева, и сид не вправе их переписывать.
 */
export async function ensureCategories(db: SeedDb): Promise<Map<string, string>> {
  const existing = await db
    .select({ id: categories.id, slug: categories.slug, parentId: categories.parentId })
    .from(categories);
  const bySlug = new Map(existing.map((r) => [r.slug, r.id]));
  const byId = new Map(existing.map((r) => [r.id, r]));

  const paths = new Map<string, string>();
  let created = 0;

  for (const root of SEED_CATEGORIES) {
    const rootSlug = slugify(root.name);
    let rootId = bySlug.get(rootSlug);
    if (!rootId) {
      rootId = newId();
      await db.insert(categories).values({
        id: rootId, parentId: null, name: root.name,
        slug: rootSlug, vertical: root.vertical,
      });
      bySlug.set(rootSlug, rootId);
      created += 1;
    }

    for (const child of root.children) {
      const childSlug = child.slug ?? slugify(child.name);
      let childId = bySlug.get(childSlug);
      // Найденная по слагу категория может оказаться не тем, чем мы её считаем:
      // с другим родителем она стоит в другом месте дерева, и объявления уедут
      // не туда, а адреса каталога соберутся не те. Молчать об этом нельзя.
      if (childId) {
        const existing = byId.get(childId);
        if (existing && existing.parentId !== rootId) {
          console.warn(
            `Categories: «${childSlug}» уже есть, но не под «${root.name}» — ` +
            "объявления встанут в существующую категорию, проверьте дерево",
          );
        }
      }
      if (!childId) {
        childId = newId();
        await db.insert(categories).values({
          id: childId, parentId: rootId, name: child.name,
          slug: childSlug, vertical: root.vertical,
        });
        bySlug.set(childSlug, childId);
        created += 1;
      }
      paths.set(categoryPath(root.name, child.name), childId);
    }
  }

  if (created > 0) console.log(`Categories: created ${created}`);
  return paths;
}
