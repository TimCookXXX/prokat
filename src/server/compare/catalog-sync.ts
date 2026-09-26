// Приводит справочник сравнения в БД к lib/compare/catalog-data.
// Идемпотентно, безопасно для production (вызывается из entrypoint при старте):
// - города и категории только создаются, если их нет (правятся в админке);
//   у существующего города заполняется пустой предложный падеж;
// - группы и классы — upsert по slug: код — источник истины;
// - места (geo-data), бренды и модели (models-data) — upsert по slug; написания
//   моделей пересобираются из справочника (ключи, добавленные импортом, остаются);
// - ничего не удаляется: на классы ссылаются предложения. Группы и классы,
//   пропавшие из справочника, возвращаются в отчёте как orphan.

import { eq, isNull, isNotNull, and, notInArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  brands, categories, cities, districts, itemClasses, itemGroups, modelAliases, offers, productModels,
} from "@db/schema";
import { newId } from "@/lib/id";
import { CATALOG, CATALOG_CITIES, type CatalogCategory, type CatalogCity } from "@/lib/compare/catalog-data";
import { CITY_GEO, type CatalogCityGeo } from "@/lib/compare/geo-data";
import { BRANDS, MODELS, type CatalogBrand, type CatalogModel } from "@/lib/compare/models-data";
import { brandWordSet, modelAliasKeys, modelKey, offerModelKey, stopWordSet } from "@/lib/compare/models";

type Tx = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];

export interface CatalogSyncReport {
  citiesCreated: number;
  categoriesCreated: number;
  groupsUpserted: number;
  classesUpserted: number;
  districtsUpserted: number;
  modelsUpserted: number;
  aliasesAdded: number;
  /** Модели, чей бренд или класс не найден, и написания, занятые другой моделью. */
  modelProblems: string[];
  orphanGroups: string[];
  orphanClasses: string[];
}

export interface CatalogSource {
  catalog?: CatalogCategory[];
  cities?: CatalogCity[];
  geo?: CatalogCityGeo[];
  brands?: CatalogBrand[];
  models?: CatalogModel[];
}

export async function syncCatalog(
  db: NodePgDatabase,
  { catalog = CATALOG, cities: catalogCities = CATALOG_CITIES, geo = CITY_GEO, brands: brandList = BRANDS, models = MODELS }: CatalogSource = {},
): Promise<CatalogSyncReport> {
  return db.transaction(async (tx) => {
    const report: CatalogSyncReport = {
      citiesCreated: 0, categoriesCreated: 0, groupsUpserted: 0, classesUpserted: 0,
      districtsUpserted: 0, modelsUpserted: 0, aliasesAdded: 0, modelProblems: [],
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
            searchKeywords: cl.keywords ?? [],
            sort: classIndex,
          };
          await tx.insert(itemClasses)
            .values({ id: newId(), slug: cl.slug, ...classFields })
            .onConflictDoUpdate({ target: itemClasses.slug, set: classFields });
          report.classesUpserted++;
        }
      }
    }

    report.districtsUpserted = await syncGeo(tx, geo);
    const m = await syncModels(tx, brandList, models, catalog);
    report.modelsUpserted = m.upserted;
    report.aliasesAdded = m.aliasesAdded;
    report.modelProblems = m.problems;

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

async function syncGeo(tx: Tx, geo: CatalogCityGeo[]): Promise<number> {
  let n = 0;
  for (const cityGeo of geo) {
    const [city] = await tx.select({ id: cities.id }).from(cities).where(eq(cities.slug, cityGeo.citySlug)).limit(1);
    if (!city) continue;
    const okrugIds = new Map<string, string>();
    for (const [i, o] of cityGeo.okrugs.entries()) {
      const fields = { kind: "okrug" as const, name: o.name, aliases: o.aliases, lat: o.lat, lon: o.lon, parentId: null, sort: i };
      const [{ id }] = await tx.insert(districts)
        .values({ id: newId(), cityId: city.id, slug: o.slug, ...fields })
        .onConflictDoUpdate({ target: [districts.cityId, districts.slug], set: fields })
        .returning({ id: districts.id });
      okrugIds.set(o.slug, id);
      n++;
    }
    for (const [i, d] of cityGeo.microdistricts.entries()) {
      const fields = {
        kind: "microdistrict" as const, name: d.name, aliases: d.aliases, lat: d.lat, lon: d.lon,
        parentId: okrugIds.get(d.okrug) ?? null, sort: i,
      };
      await tx.insert(districts)
        .values({ id: newId(), cityId: city.id, slug: d.slug, ...fields })
        .onConflictDoUpdate({ target: [districts.cityId, districts.slug], set: fields });
      n++;
    }
  }
  return n;
}

async function syncModels(
  tx: Tx, brandList: CatalogBrand[], models: CatalogModel[], catalog: CatalogCategory[],
): Promise<{ upserted: number; aliasesAdded: number; problems: string[] }> {
  const problems: string[] = [];
  const brandIds = new Map<string, string>();
  for (const b of brandList) {
    const fields = { name: b.name, aliases: b.aliases };
    const [{ id }] = await tx.insert(brands).values({ id: newId(), slug: b.slug, ...fields })
      .onConflictDoUpdate({ target: brands.slug, set: fields }).returning({ id: brands.id });
    brandIds.set(b.slug, id);
  }
  const classRows = await tx.select({ id: itemClasses.id, slug: itemClasses.slug }).from(itemClasses);
  const classIds = new Map(classRows.map((c) => [c.slug, c.id]));
  const opts = {
    brandWords: brandWordSet(brandList),
    stopWords: stopWordSet(catalog.flatMap((c) => c.groups.flatMap((g) => [g.name, ...g.classes.map((cl) => cl.name)]))),
  };

  let upserted = 0;
  let aliasesAdded = 0;
  for (const m of models) {
    const brand = brandList.find((b) => b.slug === m.brand);
    const brandId = brandIds.get(m.brand);
    const classId = classIds.get(m.cls);
    if (!brand || !brandId || !classId) {
      problems.push(`${m.slug}: ${!brandId ? `нет бренда ${m.brand}` : `нет класса ${m.cls}`}`);
      continue;
    }
    const fields = {
      brandId, itemClassId: classId, name: m.name, family: m.family ?? null,
      specs: m.specs ?? {}, specsSourceUrl: m.specsSourceUrl ?? null,
    };
    const [{ id }] = await tx.insert(productModels).values({ id: newId(), slug: m.slug, ...fields })
      .onConflictDoUpdate({ target: productModels.slug, set: fields }).returning({ id: productModels.id });
    upserted++;
    for (const alias of modelAliasKeys(m, brand, opts)) {
      const [row] = await tx.insert(modelAliases).values({ alias, modelId: id })
        .onConflictDoNothing().returning({ alias: modelAliases.alias });
      if (row) { aliasesAdded++; continue; }
      const [taken] = await tx.select({ modelId: modelAliases.modelId }).from(modelAliases).where(eq(modelAliases.alias, alias));
      if (taken && taken.modelId !== id) problems.push(`${m.slug}: написание «${alias}» уже у другой модели`);
    }
  }
  // Предложения без модели, чьё написание теперь распознаётся, привязываются к модели
  // (если у проката в этом классе ещё нет предложения на ту же модель).
  const aliasRows = await tx.select({ alias: modelAliases.alias, modelId: modelAliases.modelId, classId: productModels.itemClassId })
    .from(modelAliases).innerJoin(productModels, eq(productModels.id, modelAliases.modelId));
  const byAlias = new Map(aliasRows.map((a) => [a.alias, a]));
  const loose = await tx.select({ id: offers.id, shopId: offers.shopId, itemClassId: offers.itemClassId, model: offers.model })
    .from(offers).where(and(isNull(offers.modelId), isNotNull(offers.model)));
  for (const o of loose) {
    const raw = modelKey(o.model!, opts);
    // Модель из другого класса не привязываем — как импорт (resolveOfferModel).
    const known = byAlias.get(raw);
    const modelId = known && known.classId === o.itemClassId ? known.modelId : null;
    // Нераспознанным — ключ по тем же правилам, что у импорта (в миграции он временный).
    const key = offerModelKey(modelId, raw);
    const [dup] = await tx.select({ id: offers.id }).from(offers)
      .where(and(eq(offers.shopId, o.shopId), eq(offers.itemClassId, o.itemClassId), eq(offers.modelKey, key))).limit(1);
    if (!dup || dup.id === o.id) await tx.update(offers).set({ modelId, modelKey: key }).where(eq(offers.id, o.id));
  }
  return { upserted, aliasesAdded, problems };
}
