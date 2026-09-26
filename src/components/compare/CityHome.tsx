import Link from "next/link";
import { content } from "@theme/content";
import type { City } from "@/server/catalog";
import { getCityGeo, getCompareCatalog, getSearchData, type NavCategory } from "@/server/compare";
import { suggestEnabled } from "@/server/geocoder";
import { addDaysStr } from "@/lib/catalog/dates";
import { STALE_AFTER_DAYS } from "@/lib/compare/pricing";
import { CITY_LOCATION } from "@/lib/compare/geo";
import { localToday, modelPath } from "@/lib/compare/scenario";
import { SearchBar } from "./SearchBar";
import { GroupCard, ModelCard } from "./GroupCard";
import { TrustPoints } from "./TrustPoints";

/** Популярные группы: с ценами, по числу прокатов. */
export function popularGroups(catalog: NavCategory[], limit = 6) {
  return catalog
    .flatMap((c) => c.groups)
    .filter((g) => g.shops > 0)
    .sort((a, b) => b.shops - a.shops)
    .slice(0, limit);
}

// Главная сравнения для города (ТЗ, п. 6): поиск «Что · Когда · Где» и «Найти»,
// карточки популярных классов и моделей с ценой «от» и числом прокатов, блок
// «Как мы считаем цены».
// Главная сайта — это главная города по умолчанию; /{city} — та же для города.
export async function CityHome({ city }: { city: City }) {
  const today = localToday();
  const freshSince = addDaysStr(today, -STALE_AFTER_DAYS);
  const catalog = await getCompareCatalog(city.id, freshSince);
  const [search, geo] = await Promise.all([getSearchData(city.id, freshSince, catalog), getCityGeo(city.id)]);
  const brandNames = new Map(search.brands.map((b) => [b.slug, b.name]));
  const popularModels = search.models.filter((m) => m.shops > 0)
    .sort((a, b) => b.shops - a.shops || (a.fromDay ?? Infinity) - (b.fromDay ?? Infinity))
    .slice(0, 6);
  const cityIn = `в ${city.namePrepositional ?? city.name}`;
  const popular = popularGroups(catalog);
  const categories = catalog.filter((c) => c.groups.some((g) => g.shops > 0));

  return (
    <main>
      <section className="bg-header pb-12 pt-8 text-header-foreground md:pb-14 md:pt-10">
        <div className="page flex flex-col gap-8 md:gap-10">
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="font-display text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] md:text-[50px]">
              {content.home.compareTitle}
            </h1>
            <p className="max-w-2xl text-base text-header-muted md:text-lg">{content.home.compareSubtitle(cityIn)}</p>
          </div>
          {catalog.length > 0 && (
            <SearchBar
              variant="hero"
              citySlug={city.slug}
              cityName={city.name}
              search={search}
              geo={geo}
              addressEnabled={suggestEnabled()}
              today={today}
              value={{ what: { label: "", target: null }, from: null, to: null, loc: CITY_LOCATION }}
            />
          )}
        </div>
      </section>

      <div className="page flex flex-col gap-11 pb-14 pt-10 md:pt-12">
        {popular.length > 0 && (
          <section aria-labelledby="popular" className="flex flex-col gap-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 id="popular" className="font-display text-xl font-semibold md:text-[26px]">
                {content.home.popularHeading(cityIn)}
              </h2>
              <nav aria-label="Категории" className="flex flex-wrap gap-x-5 gap-y-1">
                {categories.map((c) => (
                  <Link key={c.slug} href={`/${city.slug}/${c.slug}` as never} className="text-[15px] font-semibold text-accent hover:underline">
                    Все: {c.name.toLowerCase()}
                  </Link>
                ))}
              </nav>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {popular.map((g) => <GroupCard key={g.slug} group={g} href={`/${city.slug}/${g.slug}`} />)}
            </div>
          </section>
        )}
        {popularModels.length > 0 && (
          <section aria-labelledby="popular-models" className="flex flex-col gap-5">
            <h2 id="popular-models" className="font-display text-xl font-semibold md:text-[26px]">Популярные модели</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {popularModels.map((m) => (
                <ModelCard
                  key={m.slug}
                  title={`${brandNames.get(m.brand) ?? ""} ${m.name}`.trim()}
                  groupSlug={m.groupSlug}
                  shops={m.shops}
                  fromDay={m.fromDay}
                  href={modelPath(city.slug, search.seoWords[m.groupSlug] ?? "prokat", m.slug)}
                />
              ))}
            </div>
          </section>
        )}
        <section aria-labelledby="how" className="flex flex-col gap-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h2 id="how" className="font-display text-xl font-semibold md:text-[26px]">Как мы считаем цены</h2>
            <Link href={"/kak-schitaem-ceny" as never} className="text-[15px] font-semibold text-accent hover:underline">Подробнее</Link>
          </div>
          <TrustPoints />
        </section>
      </div>
    </main>
  );
}
