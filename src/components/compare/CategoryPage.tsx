import Link from "next/link";
import type { City } from "@/server/catalog";
import type { NavCategory } from "@/server/compare";
import { buildBreadcrumbJsonLd } from "@/lib/jsonld";
import { siteConfig } from "@/lib/site-config";
import { JsonLd } from "@/components/seo/JsonLd";
import { GroupCard } from "./GroupCard";
import { TrustPoints } from "./TrustPoints";

// Категория сравнения /{city}/{category} («Весь инструмент»): все группы
// категории. Группы без цен тоже видны — «цены собираем».
export function CategoryPage({ city, category }: { city: City; category: NavCategory }) {
  const cityIn = `в ${city.namePrepositional ?? city.name}`;
  const withOffers = category.groups.filter((g) => g.shops > 0);
  const rest = category.groups.filter((g) => g.shops === 0);
  return (
    <main className="page flex flex-col gap-8 pb-14 pt-6 md:pt-8">
      <JsonLd data={buildBreadcrumbJsonLd([
        { name: "Главная", url: "/" },
        { name: city.name, url: `/${city.slug}` },
        { name: category.name, url: `/${city.slug}/${category.slug}` },
      ], siteConfig.url)} />
      <div className="flex flex-col gap-1.5">
        <nav aria-label="Навигация" className="text-[13px] text-muted-foreground">
          <Link href={`/${city.slug}` as never} className="hover:text-accent">{city.name}</Link> / {category.name}
        </nav>
        <h1 className="font-display text-2xl font-semibold tracking-display md:text-[28px]">
          {category.name} напрокат {cityIn}
        </h1>
        <p className="text-sm text-muted-foreground">
          Выберите, что нужно, — покажем итог за ваши даты у каждого проката.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...withOffers, ...rest].map((g) => <GroupCard key={g.slug} group={g} href={`/${city.slug}/${g.slug}`} />)}
      </div>
      <TrustPoints />
    </main>
  );
}
