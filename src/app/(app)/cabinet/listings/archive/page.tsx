import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { requireAuthState } from "@/lib/auth/guard";
import { countNewRequestsByListing, getOwnerListings } from "@/server/owner";
import { getAllCategories, listingPhotos } from "@/server/catalog";
import { ListingsList, type ListingRow } from "@/components/cabinet/ListingsList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Архив объявлений", robots: { index: false } };

// Статический сегмент выигрывает у соседнего динамического [id], так что
// маршрут с ним не спорит; ULID строкой «archive» быть не может в принципе.
export default async function CabinetArchivePage() {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/cabinet");

  const [all, pendingByListing, cats] = await Promise.all([
    getOwnerListings(session.user.id),
    countNewRequestsByListing(session.user.id),
    getAllCategories(),
  ]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  // По времени последней правки, а не создания: сверху то, что убрали только
  // что, — за ним и возвращаются.
  const items = all
    .filter((l) => l.status === "archived")
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  // Занятость и витрина архивным не нужны: из каталога они убраны, а календарь
  // у архивной вещи не показывается.
  const rows: ListingRow[] = items.map((l) => ({
    id: l.id,
    title: l.title,
    photoUrl: listingPhotos(l)[0]?.url ?? null,
    categoryName: catName.get(l.categoryId) ?? null,
    priceDay: l.priceDay,
    depositType: l.depositType,
    depositAmount: l.depositAmount,
    status: l.status,
    freeToday: null,
    quantity: l.quantity,
    // Архивная вещь из каталога убрана, но заявка по ней могла остаться
    // ждущей ответа — прочерк тут врал бы.
    pendingRequests: pendingByListing.get(l.id) ?? 0,
    publicHref: null,
  }));

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
          <ListingsList rows={rows} />
        </>
      )}
    </section>
  );
}
