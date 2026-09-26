// Приводит справочник сравнения в БД к lib/compare/catalog-data.
// Идемпотентно, безопасно для production (вызывается из entrypoint при старте):
// - города и категории только создаются, если их нет (правятся в админке);
//   у существующего города заполняется пустой предложный падеж;
// - группы и классы — upsert по slug: код — источник истины;
// - ничего не удаляется: на классы ссылаются предложения. Группы и классы,
//   пропавшие из справочника, возвращаются в отчёте как orphan.

import { eq, isNull, and, notInArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { categories, cities, itemClasses, itemGroups } from "@db/schema";
import { newId } from "@/lib/id";
import { CATALOG, CATALOG_CITIES, type CatalogCategory, type CatalogCity } from "@/lib/compare/catalog-data";

export interface CatalogSyncReport {
  citiesCreated: number;
  categoriesCreated: number;
  groupsUpserted: number;
  classesUpserted: number;
  orphanGroups: string[];
  orphanClasses: string[];
}

export async function syncCatalog(
  db: NodePgDatabase,
  catalog: CatalogCategory[] = CATALOG,
  catalogCities: CatalogCity[] = CATALOG_CITIES,
): Promise<CatalogSyncReport> {
  return db.transaction(async (tx) => {
    const report: CatalogSyncReport = {
      citiesCreated: 0, categoriesCreated: 0, groupsUpserted: 0, classesUpserted: 0,
      orphanGroups: [], orphanClasses: [],
    };

    for (const c of catalogCities) {
      const created = await tx.insert(cities)
        .values({ id: newId(), ...c })
        .onConflictDoNothing({ target: cities.slug })
        .returning({ id: cities.id });
      report.citiesCreated += created.length;
      await tx.update(cities)
        .set({ namePrepositional: c.namePrepositional })
        .where(and(eq(cities.slug, c.slug), isNull(cities.namePrepositional)));
    }

    for (const [catIndex, cat] of catalog.entries()) {
      const created = await tx.insert(categories)
        .values({ id: newId(), parentId: null, name: cat.name, slug: cat.slug, vertical: cat.vertical })
        .onConflictDoNothing({ target: categories.slug })
        .returning({ id: categories.id });
      report.categoriesCreated += created.length;
      const [{ id: categoryId }] = await tx.select({ id: categories.id })
        .from(categories).where(eq(categories.slug, cat.slug)).limit(1);

      for (const [groupIndex, g] of cat.groups.entries()) {
        const groupFields = {
          categoryId,
          name: g.name,
          nameGenitive: g.nameGenitive,
          seoWord: g.seoWord,
          guide: g.guide ?? null,
          searchKeywords: g.keywords ?? [],
          sort: catIndex * 1000 + groupIndex,
        };
        const [{ id: groupId }] = await tx.insert(itemGroups)
          .values({ id: newId(), slug: g.slug, ...groupFields })
          .onConflictDoUpdate({ target: itemGroups.slug, set: groupFields })
          .returning({ id: itemGroups.id });
        report.groupsUpserted++;

        for (const [classIndex, cl] of g.classes.entries()) {
          const classFields = {
            groupId,
            name: cl.name,
            shortHint: cl.shortHint ?? null,
            sort: classIndex,
          };
          await tx.insert(itemClasses)
            .values({ id: newId(), slug: cl.slug, ...classFields })
            .onConflictDoUpdate({ target: itemClasses.slug, set: classFields });
          report.classesUpserted++;
        }
      }
    }

    const groupSlugs = catalog.flatMap((c) => c.groups.map((g) => g.slug));
    const classSlugs = catalog.flatMap((c) => c.groups.flatMap((g) => g.classes.map((cl) => cl.slug)));
    report.orphanGroups = (await tx.select({ slug: itemGroups.slug }).from(itemGroups)
      .where(groupSlugs.length ? notInArray(itemGroups.slug, groupSlugs) : undefined))
      .map((r) => r.slug);
    report.orphanClasses = (await tx.select({ slug: itemClasses.slug }).from(itemClasses)
      .where(classSlugs.length ? notInArray(itemClasses.slug, classSlugs) : undefined))
      .map((r) => r.slug);

    return report;
  });
}
