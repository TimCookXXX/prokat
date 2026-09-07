import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive } from "lucide-react";
import { requireAuthState } from "@/lib/auth/guard";
import { getOwnerListings } from "@/server/owner";
import { getActiveCities, getAllCategories, getAvailabilityRows } from "@/server/catalog";
import { listingPath } from "@/lib/catalog/listing-path";
import { buildAvailabilityByListing } from "@/lib/catalog/availability";
import { todayStr } from "@/lib/catalog/dates";
import { ruPlural } from "@/lib/plural";
import { Button } from "@/components/ui/button";
import { CabinetListingCard } from "@/components/cabinet/CabinetListingCard";
import { ListingCardActions } from "@/components/cabinet/ListingCardActions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Мои объявления", robots: { index: false } };

export default async function CabinetListingsPage() {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/cabinet");

  const [all, cities, cats] = await Promise.all([
    getOwnerListings(session.user.id),
    getActiveCities(),
    getAllCategories(),
  ]);
  const citySlug = new Map(cities.map((c) => [c.id, c.slug]));
  const catSlug = new Map(cats.map((c) => [c.id, c.slug]));

  // Архивные живут в своём разделе. Всё на странице считается по видимому
  // списку, а не по `all`: заархивировав последнее объявление, иначе получаешь
  // счётчик «3 объявления» над пустой сеткой и ни одного слова на экране.
  const items = all.filter((l) => l.status !== "archived");
  const archivedCount = all.length - items.length;

  // Занятость — одним запросом на страницу и только по активным: у скрытых
  // плашки нет, а без строк занятости freeQty вернул бы всё количество и
  // нарисовал бы им зелёное «Свободно».
  const from = todayStr();
  const activeIds = items.filter((l) => l.status === "active").map((l) => l.id);
  const availByListing = buildAvailabilityByListing(
    await getAvailabilityRows(activeIds, from, from),
  );

  return (
    <section aria-label="Мои объявления">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm text-muted-foreground">
            {items.length} {ruPlural(items.length, "объявление", "объявления", "объявлений")}
          </p>
          {archivedCount > 0 && (
            <Link
              href="/cabinet/listings/archive"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              <Archive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Архив · {archivedCount}
            </Link>
          )}
        </div>
        {/* На десктопе разместить можно из шапки сайта и из блока над кабинетом,
          * поэтому третья кнопка здесь — шум. На мобиле шапочной кнопки нет, и
          * убирать эту нельзя. Пустой список — исключение: там кнопка и есть
          * призыв к действию. */}
        <Button asChild size="sm" className={items.length > 0 ? "md:hidden" : undefined}>
          <Link href={"/cabinet/listings/new" as never}>+ Разместить</Link>
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState>
          {archivedCount > 0
            ? "Все объявления в архиве — верните любое оттуда или разместите новое."
            : "Разместите первое объявление — оно появится в каталоге."}
        </EmptyState>
      ) : (
        // Две колонки на телефоне: подвал у карточки исчез, действия уехали на
        // фото, и в ~156px она помещается. Дальше ширину считает сама сетка.
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] md:gap-4">
          {items.map((l) => {
            return (
              <li key={l.id}>
                <CabinetListingCard
                  listing={l}
                  availabilityMap={availByListing.get(l.id) ?? new Map()}
                  from={from}
                  actions={
                    <ListingCardActions listingId={l.id} status={l.status} title={l.title} />
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
