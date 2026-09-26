// /{city}/{seg}:
// 0) список прокатов (/krasnodar/prokaty) и поиск по тексту (/krasnodar/poisk?q=…);
// 1) страница сравнения, если seg — слаг группы (/krasnodar/prokat-perforatora);
// 2) страница модели, если seg — {prokat|arenda}-{модель} (/krasnodar/prokat-karcher-puzzi-8-1);
// 3) категория сравнения, если в категории есть группы (/krasnodar/instrumenty);
// 4) иначе, с P2P-контуром, — категория объявлений (слаг категории уникален
//    глобально). Подкатегория по прямому слагу редиректится на канонический
//    /{city}/{root}/{sub}. Карточка товара — на третьем сегменте, см. [sub]/page.tsx.
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { seo } from "@theme/seo";
import {
  getAllCategories, getCategoryBySlug, getCityBySlug, getListingCountsByCategory,
  type Category, type City,
} from "@/server/catalog";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { CategoryListing, type CategorySearchParams } from "@/components/catalog/CategoryListing";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildBreadcrumbJsonLd } from "@/lib/jsonld";
import { siteConfig } from "@/lib/site-config";
import { getCompareCatalog, getGroupBySlug, getModelBySeg } from "@/server/compare";
import {
  GroupResult, ModelResult, SearchResult, groupMetadata, modelMetadata, searchMetadata,
} from "@/components/compare/ResultRoutes";
import { CategoryPage } from "@/components/compare/CategoryPage";
import { ShopsList } from "@/components/compare/ShopsList";
import { SEARCH_SEGMENT, SHOPS_SEGMENT } from "@/lib/compare/catalog-data";
import { addDaysStr } from "@/lib/catalog/dates";
import { STALE_AFTER_DAYS } from "@/lib/compare/pricing";
import { localToday } from "@/lib/compare/scenario";
import { isP2PEnabled, requireP2P } from "@/lib/features";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ city: string; seg: string }>;
  searchParams: Promise<CategorySearchParams>;
}

async function resolve(citySlug: string, seg: string) {
  const city = await getCityBySlug(citySlug);
  if (!city) return null;
  const category = await getCategoryBySlug(seg);
  if (!category) return null;
  return { city, category };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: citySlug, seg } = await params;
  if (seg === SHOPS_SEGMENT) {
    const city = await getCityBySlug(citySlug);
    if (!city) return {};
    return {
      title: seo.titleTemplate(`Прокаты в ${city.namePrepositional ?? city.name}`),
      alternates: { canonical: `${siteConfig.url}/${city.slug}/${SHOPS_SEGMENT}` },
    };
  }
  if (seg === SEARCH_SEGMENT) return searchMetadata;
  const compare = await resolveCompare(citySlug, seg);
  if (compare) return groupMetadata(compare.city, compare.g);
  const model = await resolveModel(citySlug, seg);
  if (model) return modelMetadata(model.city, model.m);
  const compareCat = await resolveCompareCategory(citySlug, seg);
  if (compareCat) {
    const { city, category } = compareCat;
    const cityIn = `в ${city.namePrepositional ?? city.name}`;
    return {
      title: seo.titleTemplate(`${category.name} напрокат ${cityIn} — сравнение цен`),
      description: `${category.name} напрокат ${cityIn}: сравните итог за ваши даты и расстояние до каждого проката.`,
      alternates: { canonical: `${siteConfig.url}/${city.slug}/${category.slug}` },
    };
  }
  if (!isP2PEnabled()) return {};
  const r = await resolve(citySlug, seg);
  if (!r) return {};
  const cat = r.category;
  return {
    title: seo.titleTemplate(`Аренда: ${cat.name.toLowerCase()} в ${r.city.name}`),
    description: `${cat.name} напрокат в ${r.city.name}: каталог товаров с ценами, залогами и календарём занятости.`,
    alternates: { canonical: `${siteConfig.url}/${r.city.slug}/${seg}` },
  };
}

async function resolveCompare(citySlug: string, seg: string) {
  const [city, g] = await Promise.all([getCityBySlug(citySlug), getGroupBySlug(seg)]);
  return city && g ? { city, g } : null;
}

async function resolveModel(citySlug: string, seg: string) {
  const [city, m] = await Promise.all([getCityBySlug(citySlug), getModelBySeg(seg)]);
  return city && m ? { city, m } : null;
}

async function resolveCompareCategory(citySlug: string, seg: string) {
  const city = await getCityBySlug(citySlug);
  if (!city) return null;
  const catalog = await getCompareCatalog(city.id, addDaysStr(localToday(), -STALE_AFTER_DAYS));
  const category = catalog.find((c) => c.slug === seg && c.groups.length > 0);
  return category ? { city, category } : null;
}

export default async function CitySegPage({ params, searchParams }: Props) {
  const { city: citySlug, seg } = await params;
  if (seg === SHOPS_SEGMENT) {
    const city = await getCityBySlug(citySlug);
    if (!city) notFound();
    return <ShopsList city={city} />;
  }
  const sp = await searchParams as Record<string, string | string[] | undefined>;
  if (seg === SEARCH_SEGMENT) {
    const city = await getCityBySlug(citySlug);
    if (!city) notFound();
    return <SearchResult city={city} searchParams={sp} />;
  }
  const compare = await resolveCompare(citySlug, seg);
  if (compare) return <GroupResult city={compare.city} g={compare.g} searchParams={sp} />;
  const model = await resolveModel(citySlug, seg);
  if (model) return <ModelResult city={model.city} m={model.m} searchParams={sp} />;
  const compareCat = await resolveCompareCategory(citySlug, seg);
  if (compareCat) return <CategoryPage city={compareCat.city} category={compareCat.category} />;
  requireP2P();
  const r = await resolve(citySlug, seg);
  if (!r) notFound();
  const { city, category } = r;

  if (category.parentId !== null) {
    // Канонический адрес подкатегории — под корневой категорией.
    const cats = await getAllCategories();
    const root = cats.find((c) => c.id === category.parentId);
    if (root) permanentRedirect(`/${city.slug}/${root.slug}/${category.slug}`);
    notFound();
  }

  return <RootCategoryPage city={city} category={category} searchParams={await searchParams} />;
}

async function RootCategoryPage({
  city, category, searchParams,
}: {
  city: City;
  category: Category;
  searchParams: CategorySearchParams;
}) {
  const [cats, directCounts] = await Promise.all([
    getAllCategories(),
    getListingCountsByCategory(city.id),
  ]);
  const children = cats.filter((c) => c.parentId === category.id);
  const subcategories = children
    .map((c) => ({ ...c, count: directCounts.get(c.id) ?? 0 }))
    .filter((c) => c.count > 0);
  const categoryIds = [category.id, ...children.map((c) => c.id)];
  const basePath = `/${city.slug}/${category.slug}`;

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6">
      <JsonLd data={buildBreadcrumbJsonLd([
        { name: "Главная", url: "/" },
        { name: city.name, url: `/${city.slug}` },
        { name: category.name, url: basePath },
      ], siteConfig.url)} />
      <Breadcrumbs items={[
        { label: "Главная", href: "/" },
        { label: city.name, href: `/${city.slug}` },
        { label: category.name },
      ]} />
      <h1 className="mb-4 mt-3 font-display text-2xl font-bold">
        Аренда: {category.name.toLowerCase()} в {city.name}
      </h1>
      <CategoryListing
        city={city}
        categoryIds={categoryIds}
        basePath={basePath}
        categoryBasePath={basePath}
        subcategories={subcategories}
        searchParams={searchParams}
      />
    </main>
  );
}
