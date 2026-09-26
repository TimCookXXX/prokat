// Страницы выдачи по ТЗ, п. 6: группа (класс), модель и поиск по тексту. Каждая
// собирает свой набор предложений и описание (ResultScope) и рисует ResultPage.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { seo } from "@theme/seo";
import type { City } from "@/server/catalog";
import {
  findGroupsByRawModel, getCityGeo, getCompareCatalog, getGroupBySlug, getGroupOffers, getModelOffers, getSearchData,
  type GroupWithClasses, type ModelPage,
} from "@/server/compare";
import { addDaysStr } from "@/lib/catalog/dates";
import { STALE_AFTER_DAYS, formatRub, minTotal, priceAll } from "@/lib/compare/pricing";
import { groupPath, localToday, modelPath, parseResultParams, targetHref } from "@/lib/compare/scenario";
import { buildSearchIndex, resolveQuery, type Chip } from "@/lib/compare/search";
import { compareTitle, shopsGenitive } from "@/lib/compare/format";
import { siteConfig } from "@/lib/site-config";
import { ResultPage, type ResultScope } from "./ComparePage";

type RawParams = Record<string, string | string[] | undefined>;

const freshSince = () => addDaysStr(localToday(), -STALE_AFTER_DAYS);

function cityCrumb(city: City) {
  return { label: city.name, href: `/${city.slug}` };
}

// ------------------------------------------------------------------ группа

export async function groupMetadata(city: City, g: GroupWithClasses): Promise<Metadata> {
  const title = compareTitle(g.group, city);
  const stat = (await getCompareCatalog(city.id, freshSince()))
    .flatMap((c) => c.groups).find((x) => x.slug === g.group.slug);
  // «Прокат перфоратора в Краснодаре — цены 8 прокатов, от 350 ₽/сутки» (ТЗ, п. 6).
  const tail = stat?.shops && stat.fromPrice
    ? ` — цены ${shopsGenitive(stat.shops)}, от ${formatRub(stat.fromPrice.rub)}/${stat.fromPrice.per === "day" ? "сутки" : "неделю"}`
    : " — сравнение цен прокатов";
  return {
    title: seo.titleTemplate(`${title}${tail}`),
    description: `${title}: итог за ваши даты у каждого проката, расстояние до проката, залог и дата проверки цены. Сравните и позвоните напрямую.`,
    alternates: { canonical: `${siteConfig.url}${groupPath(city.slug, g.group.slug)}` },
  };
}

export async function GroupResult({ city, g, searchParams }: { city: City; g: GroupWithClasses; searchParams: RawParams }) {
  const [geo, offers] = await Promise.all([getCityGeo(city.id), getGroupOffers(city.id, g.group.id)]);
  const title = compareTitle(g.group, city);
  const cityIn = ` в ${city.namePrepositional ?? city.name}`;
  const scope: ResultScope = {
    path: groupPath(city.slug, g.group.slug),
    title,
    crumbs: [cityCrumb(city), { label: g.category.name, href: `/${city.slug}/${g.category.slug}` }, { label: g.group.name }],
    what: g.group.name,
    iconGroup: g.group.slug,
    classes: g.classes.map((c) => ({ id: c.id, slug: c.slug, name: c.name, shortHint: c.shortHint })),
    showModels: true,
    guide: g.group.guide,
    faqTitle: title.replace(cityIn, ""),
    searchTarget: { groupSlug: g.group.slug },
  };
  return <ResultPage city={city} geo={geo} scope={scope} offers={offers} searchParams={searchParams} />;
}

// ------------------------------------------------------------------ модель

function modelTitle(m: ModelPage, city: City) {
  const word = m.group.seoWord === "arenda" ? "Аренда" : "Прокат";
  return `${word} ${m.model.brand} ${m.model.name} в ${city.namePrepositional ?? city.name}`;
}

export async function modelMetadata(city: City, m: ModelPage): Promise<Metadata> {
  const offers = await getModelOffers(city.id, m.model.id);
  const fresh = priceAll(offers, 1, localToday()).fresh;
  const shops = new Set(fresh.map((q) => q.offer.shopId)).size;
  const from = minTotal(fresh);
  const title = modelTitle(m, city);
  return {
    title: seo.titleTemplate(shops && from ? `${title} — цены ${shopsGenitive(shops)}, от ${formatRub(from)}/сутки` : title),
    description: `${m.model.brand} ${m.model.name} напрокат: итог за ваши даты у каждого проката, расстояние, залог и дата проверки цены.`,
    alternates: { canonical: `${siteConfig.url}${modelPath(city.slug, m.group.seoWord, m.model.slug)}` },
  };
}

export async function ModelResult({ city, m, searchParams }: { city: City; m: ModelPage; searchParams: RawParams }) {
  const [geo, offers] = await Promise.all([getCityGeo(city.id), getModelOffers(city.id, m.model.id)]);
  const full = `${m.model.brand} ${m.model.name}`;
  const scope: ResultScope = {
    path: modelPath(city.slug, m.group.seoWord, m.model.slug),
    title: modelTitle(m, city),
    crumbs: [
      cityCrumb(city),
      { label: m.category.name, href: `/${city.slug}/${m.category.slug}` },
      { label: m.group.name, href: groupPath(city.slug, m.group.slug) },
      { label: full },
    ],
    what: full,
    iconGroup: m.group.slug,
    showModels: false,
    itemClassId: m.cls.id,
    guide: m.group.guide,
    faqTitle: `${m.group.seoWord === "arenda" ? "Аренда" : "Прокат"} ${full}`,
    searchTarget: { groupSlug: m.group.slug, classSlug: m.cls.slug, modelSlugs: [m.model.slug] },
  };
  return <ResultPage city={city} geo={geo} scope={scope} offers={offers} searchParams={searchParams} />;
}

// ------------------------------------------------------------------ поиск

export const searchMetadata: Metadata = { title: seo.titleTemplate("Поиск"), robots: { index: false } };

/**
 * /{city}/poisk?q=… (ТЗ, п. 3.1): модель, бренд и класс — редирект на их страницу;
 * неоднозначное слово — чипы и все подходящие классы; ничего — запасной поиск по
 * написанию моделей у прокатов (ILIKE), затем похожее и форма заявки.
 */
export async function SearchResult({ city, searchParams }: { city: City; searchParams: RawParams }) {
  const raw = searchParams.q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 120) ?? "";
  if (!q) redirect(`/${city.slug}`);

  const today = localToday();
  const [geo, data] = await Promise.all([getCityGeo(city.id), getSearchData(city.id, freshSince())]);
  const p = parseResultParams(searchParams, today, geo);
  const index = buildSearchIndex(data);
  let r = resolveQuery(index, q, data);

  if (r.level === "none") {
    // Запасной уровень: как модель записана у самого проката — `ILIKE '%запрос%'`.
    const groups = await findGroupsByRawModel(city.id, q);
    if (groups.length === 1) r = { level: "class", target: { groupSlug: groups[0] }, title: q };
    else if (groups.length > 1) {
      r = {
        level: "ambiguous",
        chips: groups.map((slug) => ({ label: data.groups.find((g) => g.slug === slug)?.name ?? slug, target: { groupSlug: slug } })),
      };
    }
  }
  if (r.level === "model" || r.level === "brand" || r.level === "class") {
    redirect(targetHref(city.slug, r.target, data.seoWords, p) as never);
  }

  const chips: Chip[] = r.level === "ambiguous" ? r.chips : [];
  // До выбора уточнения — все подходящие классы вместе.
  const offers = (await Promise.all(chips.map(async (c) => {
    const g = await getGroupBySlug(c.target.groupSlug);
    if (!g) return [];
    const all = await getGroupOffers(city.id, g.group.id);
    return c.target.brandSlug ? all.filter((o) => o.brandSlug === c.target.brandSlug) : all;
  }))).flat();
  const similar = r.level === "none"
    ? r.similar.map((s) => ({ label: s.title, href: targetHref(city.slug, s.target, data.seoWords, p) }))
    : [];

  const scope: ResultScope = {
    path: `/${city.slug}/poisk?q=${encodeURIComponent(q)}`,
    title: chips.length ? `«${q}» — уточните, что нужно` : `«${q}» в ${city.namePrepositional ?? city.name}`,
    crumbs: [cityCrumb(city), { label: "Поиск" }],
    what: q,
    iconGroup: chips[0]?.target.groupSlug ?? "",
    showModels: false,
    searchTarget: null,
    chips,
    similar,
  };
  return <ResultPage city={city} geo={geo} scope={scope} offers={offers} searchParams={searchParams} />;
}
