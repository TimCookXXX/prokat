// Страница вещи в кабинете: всё, что этой вещи принадлежит, — её занятость, её
// заявки, её переписки. Раньше это был только экран правки, а занятость жила
// отдельным разделом со своим переключателем позиций: вещь приходилось выбирать
// дважды. Правка осталась здесь же, под ?tab=edit — форма длинная, держать её
// раскрытой над остальным нельзя.

import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, ImageOff } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { requireAuthState } from "@/lib/auth/guard";
import { getOwnerListing } from "@/server/owner";
import { getCabinetRequests } from "@/server/cabinet";
import { getListingThreads } from "@/server/chat";
import {
  getActiveCities, getAllCategories, getAvailabilityRows, listingPhotos,
} from "@/server/catalog";
import { leafCategories } from "@/lib/owner/categories";
import { listingPath } from "@/lib/catalog/listing-path";
import { ListingForm } from "@/components/cabinet/ListingForm";
import { FullCalendar } from "@/components/catalog/AvailabilityCalendar";
import { BlockDatesForm } from "@/components/cabinet/BlockDatesForm";
import { RequestActions } from "@/components/cabinet/RequestActions";
import { Avatar } from "@/components/ui/Avatar";
import { addDaysStr, todayStr, formatDayMonth } from "@/lib/catalog/dates";
import { formatDeposit, formatPrice } from "@/lib/catalog/format";
import { STATUS_BADGE_CLASSES, STATUS_LABELS } from "@/lib/booking/status-labels";
import type { AvailabilityMap } from "@/lib/catalog/availability";
import { BOOKING_HORIZON_DAYS } from "@/lib/booking/params";

export const dynamic = "force-dynamic";

const STATUS_WORD = { active: "Активно", hidden: "Скрыто", archived: "Архив" } as const;

// Заголовок вкладки — название вещи: список объявлений и одна вещь в истории
// браузера иначе называются одинаково.
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const session = await requireAuthState();
  if (!session) return { title: "Объявление", robots: { index: false } };
  const listing = await getOwnerListing(session.user.id, (await params).id);
  return {
    title: listing?.title ?? "Объявление",
    robots: { index: false },
  };
}

export default async function CabinetListingPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/cabinet");

  const { id } = await params;
  const rawTab = (await searchParams).tab;
  const editing = (Array.isArray(rawTab) ? rawTab[0] : rawTab) === "edit";

  const listing = await getOwnerListing(session.user.id, id);
  if (!listing) notFound();

  const isArchived = listing.status === "archived";
  const backHref = isArchived ? "/cabinet/listings/archive" : "/cabinet/listings";
  const selfHref = `/cabinet/listings/${listing.id}`;

  const back = (
    /* Только на десктопе: на мобиле кнопку «назад» рисует сама оболочка
     * кабинета, и вторая шла бы сразу за ней. */
    <Link
      href={(editing ? selfHref : backHref) as never}
      className="mb-3 hidden items-center gap-1 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline md:inline-flex"
    >
      <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
      {editing ? "К вещи" : isArchived ? "К архиву" : "К объявлениям"}
    </Link>
  );

  // Справочники нужны только форме — на самой странице вещи их не читаем.
  if (editing) {
    const [cities, cats] = await Promise.all([getActiveCities(), getAllCategories()]);
    return (
      <main>
        {back}
        <ListingForm
          mode="edit"
          listingId={listing.id}
          returnHref={selfHref}
          cities={cities.map((c) => ({ id: c.id, name: c.name }))}
          categories={leafCategories(cats)}
          initial={{
            title: listing.title,
            cityId: listing.cityId,
            categoryId: listing.categoryId,
            location: listing.location ?? "",
            description: listing.description ?? "",
            priceDay: String(listing.priceDay),
            depositType: listing.depositType,
            depositAmount: listing.depositAmount?.toString() ?? "",
            quantity: String(listing.quantity),
            handoverPickup: listing.handoverPickup,
            handoverDelivery: listing.handoverDelivery,
            photos: listingPhotos(listing),
          }}
        />
      </main>
    );
  }

  const from = todayStr();
  // Занятость архивной вещи не показываем: сдать её нельзя, и календарь с
  // формой закрытия дат предлагали бы действие, которого не существует. Тем же
  // правилом жил прежний раздел календаря — он отфильтровывал архив.
  const [availRows, requests, threads] = await Promise.all([
    isArchived ? [] : getAvailabilityRows([listing.id], from, addDaysStr(from, 41)),
    getCabinetRequests(session.user.id, { role: "owner", listingId: listing.id }),
    getListingThreads(listing.id, session.user.id),
  ]);
  const map: AvailabilityMap = new Map(
    availRows.map((r) => [r.date, { bookedQty: r.bookedQty, blockedQty: r.blockedQty }]),
  );
  const photo = listingPhotos(listing)[0];

  return (
    <main className="flex flex-col gap-6">
      {back}

      <header className="flex gap-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
          {photo ? (
            <Image src={photo.url} alt="" fill sizes="80px" className="object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-6 w-6" aria-hidden="true" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-bold leading-tight">{listing.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatPrice(listing.priceDay)} в сутки
            {" · "}{formatDeposit(listing.depositType, listing.depositAmount)}
            {listing.quantity > 1 ? ` · ${listing.quantity} шт.` : ""}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {STATUS_WORD[listing.status]}
            </span>
            <Link href={`${selfHref}?tab=edit` as never} className="text-accent hover:underline">
              Править
            </Link>
            {/* Витрина только у активного: у скрытого и архивного публичной
              * страницы нет, ссылка вела бы в 404. */}
            {listing.status === "active" && (
              <Link
                href={listingPath(listing.citySlug, listing.categorySlug, listing.slug, listing.id) as never}
                className="text-accent hover:underline"
              >
                Смотреть на витрине
              </Link>
            )}
          </p>
        </div>
      </header>

      {!isArchived && (
        <section aria-label="Занятость">
          <h3 className="mb-3 font-mono text-2xs uppercase tracking-mono text-muted-foreground">
            занятость
          </h3>
          <div className="max-w-xl">
            <FullCalendar quantity={listing.quantity} map={map} from={from} weeks={6} />
          </div>
          <div className="mt-4 rounded-lg border border-border bg-card p-4">
            <h4 className="mb-3 text-sm font-semibold">
              Закрыть даты вручную — «сдал по телефону», «в ремонте»
            </h4>
            <BlockDatesForm
              listingId={listing.id}
              quantity={listing.quantity}
              today={from}
              maxDate={addDaysStr(from, BOOKING_HORIZON_DAYS)}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Закрытие выставляет число недоступных единиц на каждый день диапазона
              (подтверждённые брони считаются отдельно). «0 — открыть» снимает закрытие.
            </p>
          </div>
        </section>
      )}

      <section aria-label="Заявки по этой вещи">
        <h3 className="mb-3 font-mono text-2xs uppercase tracking-mono text-muted-foreground">
          заявки · {requests.length}
        </h3>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Заявок на эту вещь пока не было.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {requests.map((row) => (
              <li
                key={row.id}
                className={`rounded-lg border bg-card p-4 ${
                  row.status === "new" ? "border-accent" : "border-border"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {row.dateFrom === row.dateTo
                        ? formatDayMonth(row.dateFrom)
                        : `${formatDayMonth(row.dateFrom)} — ${formatDayMonth(row.dateTo)}`}
                      {row.qty > 1 ? ` · ${row.qty} шт.` : ""}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      <Link href={`/u/${row.peer.id}` as never} className="hover:text-foreground">
                        {row.peer.name ?? "клиент"}
                      </Link>
                      {row.peerPhone && (
                        <>
                          {" · "}
                          <a href={`tel:${row.peerPhone.replace(/[^+\d]/g, "")}`} className="hover:text-foreground">
                            {row.peerPhone}
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                  <span className={`rounded-sm px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASSES[row.status]}`}>
                    {STATUS_LABELS[row.status]}
                  </span>
                </div>
                <div className="mt-3">
                  <RequestActions requestId={row.id} side={row.side} status={row.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Переписки по этой вещи">
        <h3 className="mb-3 font-mono text-2xs uppercase tracking-mono text-muted-foreground">
          переписки · {threads.length}
        </h3>
        {threads.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            По этой вещи вам ещё не писали.
          </p>
        ) : (
          <ul className="surface flex flex-col p-1">
            {threads.map((t, i) => (
              <li key={t.id} className="contents">
                {i > 0 && <span aria-hidden="true" className="mx-3 h-px bg-border" />}
                <Link
                  href={`/chat/${t.id}` as never}
                  className="flex min-h-[52px] items-center gap-3 rounded-sm px-3 transition-colors hoverable"
                >
                  <Avatar src={t.peerImage} name={t.peerName} size={32} />
                  <span className="min-w-0 flex-1 truncate">{t.peerName ?? "Собеседник"}</span>
                  {t.unread > 0 && (
                    <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-pill bg-accent px-1.5 text-[13px] font-bold text-accent-foreground">
                      <span aria-hidden="true">{t.unread}</span>
                      <span className="sr-only">, непрочитанных</span>
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
