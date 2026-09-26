import Link from "next/link";
import type { City } from "@/server/catalog";
import { getCityShops } from "@/server/shops";
import { SHOPS_SEGMENT } from "@/lib/compare/catalog-data";
import { ClaimedBadge } from "./OfferTicket";

// /{city}/prokaty — все прокаты города в сравнении.
export async function ShopsList({ city }: { city: City }) {
  const shops = await getCityShops(city.id);
  const cityIn = `в ${city.namePrepositional ?? city.name}`;
  return (
    <main className="page flex flex-col gap-6 pb-14 pt-6 md:pt-8">
      <div className="flex flex-col gap-1.5">
        <nav aria-label="Навигация" className="text-[13px] text-muted-foreground">
          <Link href={`/${city.slug}` as never} className="hover:text-accent">{city.name}</Link> / Прокаты
        </nav>
        <h1 className="font-display text-2xl font-semibold tracking-display md:text-[28px]">Прокаты {cityIn}</h1>
        <p className="text-sm text-muted-foreground">
          Все прокаты в одной выдаче — и те, кто с нами не работает. <Link href="/dlya-prokatov" className="text-accent hover:underline">Вы прокат?</Link>
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shops.map((s) => (
          <li key={s.slug}>
            <Link
              href={`/${city.slug}/${SHOPS_SEGMENT}/${s.slug}` as never}
              className="flex h-full flex-col gap-1 rounded-lg bg-card p-4 shadow-card transition-transform hover:-translate-y-0.5"
            >
              <span className="flex flex-wrap items-center gap-2 font-semibold">{s.name}{s.claimed && <ClaimedBadge />}</span>
              <span className="text-sm text-muted-foreground">
                {[s.district, s.offers ? `${s.offers} цен в сравнении` : "цен пока нет"].filter(Boolean).join(" · ")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
