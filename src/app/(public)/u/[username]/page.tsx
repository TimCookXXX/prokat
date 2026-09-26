// Публичный профиль продавца: аватар, имя, «на сайте с», значок «Проверен»,
// bio и сетка активных объявлений. Резолв по username.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import { User, BadgeCheck } from "lucide-react";
import { seo } from "@theme/seo";
import {
  getSellerByUsername, getActiveListingCardsByOwner, getAvailabilityRows,
} from "@/server/catalog";
import { buildAvailabilityByListing } from "@/lib/catalog/availability";
import { todayStr, addDaysStr } from "@/lib/catalog/dates";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { ListingCard } from "@/components/catalog/ListingCard";
import { siteConfig } from "@/lib/site-config";
import { isP2PEnabled, requireP2P } from "@/lib/features";

export const dynamic = "force-dynamic";

interface Props { params: Promise<{ username: string }> }

function memberSince(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(date);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!isP2PEnabled()) return {};
  const { username } = await params;
  const seller = await getSellerByUsername(username);
  if (!seller) return {};
  const name = seller.name ?? `@${username}`;
  return {
    title: seo.titleTemplate(`${name} — объявления`),
    description: `Объявления пользователя ${name}: аренда вещей с бронью онлайн.`,
    alternates: { canonical: `${siteConfig.url}/u/${username}` },
  };
}

export default async function SellerProfilePage({ params }: Props) {
  requireP2P();
  const { username } = await params;
  const seller = await getSellerByUsername(username);
  if (!seller) notFound();

  const items = await getActiveListingCardsByOwner(seller.id);
  const from = todayStr();
  const availRows = await getAvailabilityRows(items.map((i) => i.listing.id), from, addDaysStr(from, 6));
  const availByListing = buildAvailabilityByListing(availRows);

  const displayName = seller.name ?? `@${username}`;

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6">
      <Breadcrumbs items={[{ label: "Главная", href: "/" }, { label: displayName }]} />

      <header className="mt-3 flex items-start gap-4">
        <span className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground">
          {seller.image ? (
            <Image src={seller.image} alt={displayName} fill sizes="64px" className="object-cover" />
          ) : (
            <User className="h-8 w-8" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 font-display text-2xl font-bold">
            {displayName}
            {seller.isVerified && (
              <span className="inline-flex items-center gap-1 rounded-pill bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Проверен
              </span>
            )}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            @{username} · на сайте с {memberSince(seller.createdAt)}
          </p>
          {seller.bio && <p className="mt-2 max-w-2xl text-sm leading-body">{seller.bio}</p>}
        </div>
      </header>

      <section aria-labelledby="seller-listings" className="mt-8">
        <h2 id="seller-listings" className="mb-3 text-lg font-semibold">Объявления</h2>
        {items.length === 0 ? (
          <p className="py-8 text-muted-foreground">У продавца пока нет активных объявлений.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((item) => (
              <ListingCard
                key={item.listing.id}
                item={item}
                citySlug={item.citySlug}
                availabilityMap={availByListing.get(item.listing.id) ?? new Map()}
                from={from}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
