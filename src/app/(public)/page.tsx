import type { Metadata } from "next";
import { seo } from "@theme/seo";
import { auth } from "@/lib/auth";
import { authPanelProps } from "@/lib/auth/panel-props";
import { getActiveCities, getCityBySlug, getRecentListings } from "@/server/catalog";
import { DEFAULT_CITY_SLUG } from "@/lib/compare/catalog-data";
import { isP2PEnabled } from "@/lib/features";
import { CityHome } from "@/components/compare/CityHome";
import { RecentItems } from "@/components/home/RecentItems";
import { ListYourItemBand } from "@/components/home/ListYourItemBand";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // absolute — иначе к заголовку применится шаблон `%s — inrenta` из корневого
  // layout и имя задвоится.
  title: { absolute: seo.defaultTitle },
  description: seo.defaultDescription,
};

// Главная — сравнение прокатов в городе по умолчанию (Краснодар). P2P-контур,
// если включён, добавляет под сравнением ленту объявлений и «Разместить».
export default async function HomePage() {
  const city = (await getCityBySlug(DEFAULT_CITY_SLUG)) ?? (await getActiveCities())[0] ?? null;
  if (!city) {
    return <main className="page py-16 text-center text-muted-foreground">Города ещё не заведены.</main>;
  }
  if (!isP2PEnabled()) return <CityHome city={city} />;

  const [session, recent] = await Promise.all([auth(), getRecentListings(city.id, 12)]);
  const user = session?.user;
  const placeHref = !user ? "/login" : user.username ? "/cabinet/listings/new" : "/welcome";
  return (
    <>
      <CityHome city={city} />
      <RecentItems items={recent} citySlug={city.slug} />
      <div className="page pb-12">
        {/* Анониму баннер «Разместить» открывает вход модалкой, а не уводит на /login. */}
        <ListYourItemBand href={placeHref} authProps={user ? undefined : authPanelProps()} />
      </div>
    </>
  );
}
