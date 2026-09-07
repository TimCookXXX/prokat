import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { requireAuthState } from "@/lib/auth/guard";
import { getOwnerListings } from "@/server/owner";
import { todayStr } from "@/lib/catalog/dates";
import { CabinetListingCard } from "@/components/cabinet/CabinetListingCard";
import { ListingCardActions } from "@/components/cabinet/ListingCardActions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Архив объявлений", robots: { index: false } };

// Статический сегмент выигрывает у соседнего динамического [id], так что
// маршрут с ним не спорит; ULID строкой «archive» быть не может в принципе.
export default async function CabinetArchivePage() {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/cabinet");

  const all = await getOwnerListings(session.user.id);
  // По времени последней правки, а не создания: сверху то, что убрали только
  // что, — за ним и возвращаются.
  const items = all
    .filter((l) => l.status === "archived")
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  const from = todayStr();

  return (
    <section aria-label="Архив объявлений">
      {/* Слева и отдельной строкой — как на странице правки, и там же скрыта на
        * мобиле: круглую кнопку назад рисует сама оболочка кабинета, вторая шла
        * бы сразу за ней. */}
      <Link
        href="/cabinet/listings"
        className="mb-3 hidden items-center gap-1 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline md:inline-flex"
      >
        <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
        К объявлениям
      </Link>

      {/* Свой заголовок нужен: в шапке кабинета для этого адреса стоит «Мои
        * объявления» — навигация матчит по префиксу, — и без него архив
        * визуально неотличим от основного списка. h2, а не h1: h1 уже есть. */}
      <h2 className="mb-4 text-base font-semibold text-foreground">
        Архив
        {items.length > 0 && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">{items.length}</span>
        )}
      </h2>

      {items.length === 0 ? (
        <EmptyState>
          Архив пуст. Сюда попадают объявления, которые вы убрали из списка.
        </EmptyState>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            Эти объявления не видны в каталоге. Вернуть можно любое — оно
            появится в списке скрытым, и вы сами решите, публиковать ли снова.
          </p>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] md:gap-4">
            {items.map((l) => (
              <li key={l.id}>
                <CabinetListingCard
                  listing={l}
                  // В архиве витрины нет по определению — карточка ведёт в правку.
                  availabilityMap={new Map()}
                  from={from}
                  actions={
                    <ListingCardActions listingId={l.id} status={l.status} title={l.title} />
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
