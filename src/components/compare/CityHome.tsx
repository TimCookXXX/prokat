import Link from "next/link";
import { content } from "@theme/content";
import type { City } from "@/server/catalog";
import { getCompareCatalog, getSearchModels, toSearchData, type NavCategory } from "@/server/compare";
import { addDaysStr } from "@/lib/catalog/dates";
import { STALE_AFTER_DAYS } from "@/lib/compare/pricing";
import { localToday } from "@/lib/compare/scenario";
import { SearchBar } from "./SearchBar";
import { GroupCard } from "./GroupCard";
import { TrustPoints } from "./TrustPoints";

/** Популярные группы: с ценами, по числу прокатов. */
export function popularGroups(catalog: NavCategory[], limit = 6) {
  return catalog
    .flatMap((c) => c.groups)
    .filter((g) => g.shops > 0)
    .sort((a, b) => b.shops - a.shops)
    .slice(0, limit);
}

// Главная сравнения для города (макет HomeB): большой поиск «что · когда · куда»,
// карточки групп с ценой «от», три пункта «почему цене можно верить».
// Главная сайта — это главная города по умолчанию; /{city} — та же для города.
export async function CityHome({ city }: { city: City }) {
  const today = localToday();
  const freshSince = addDaysStr(today, -STALE_AFTER_DAYS);
  const [catalog, models] = await Promise.all([
    getCompareCatalog(city.id, freshSince),
    getSearchModels(city.id, freshSince),
  ]);
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
              search={toSearchData(catalog, models)}
              today={today}
              value={{ groupSlug: null, classSlug: null, from: null, to: null }}
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
        <TrustPoints />
      </div>
    </main>
  );
}
