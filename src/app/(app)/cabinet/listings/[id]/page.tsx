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
import { ListingAvailability } from "@/components/cabinet/ListingAvailability";
import { RequestActions } from "@/components/cabinet/RequestActions";
import { ListingRowActions } from "@/components/cabinet/ListingRowActions";
import { Avatar } from "@/components/ui/Avatar";
import { addDaysStr, todayStr, formatDayMonth } from "@/lib/catalog/dates";
import { ruPlural } from "@/lib/plural";
import { formatDeposit, formatPrice } from "@/lib/catalog/format";
import { STATUS_BADGE_CLASSES, STATUS_LABELS } from "@/lib/booking/status-labels";
import { occupancySummary, type AvailabilityMap } from "@/lib/catalog/availability";
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
  const publicHref = listingPath(
    listing.citySlug, listing.categorySlug, listing.slug, listing.id,
  );

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
  const horizon = addDaysStr(from, BOOKING_HORIZON_DAYS);
  const [availRows, requests, threads] = await Promise.all([
    // На весь горизонт, а не на шесть недель: календарь листается по месяцам, и
    // строки за дальние месяцы нужны сразу — иначе они выглядели бы свободными.
    isArchived ? [] : getAvailabilityRows([listing.id], from, horizon),
    getCabinetRequests(session.user.id, { role: "owner", listingId: listing.id }),
    getListingThreads(listing.id, session.user.id),
  ]);
  const map: AvailabilityMap = new Map(
    availRows.map((r) => [r.date, { bookedQty: r.bookedQty, blockedQty: r.blockedQty }]),
  );
  // Окно сводки — месяц: столько владелец и держит в голове, а календарь
  // ниже отвечает на всё остальное.
  const summary = occupancySummary(listing.quantity, map, from, addDaysStr(from, 30));
  const photo = listingPhotos(listing)[0];

  return (
    <main className="flex flex-col gap-4">
      {back}

      {/* Шапка вещи — карточка, а не голый текст: страница целиком стояла на
        * фоне без единой подложки и читалась документом, а не экраном. */}
      <header className="surface flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
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
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
            <h2 className="min-w-0 flex-1 break-words font-display text-xl font-bold leading-tight">
              {listing.title}
            </h2>
            <span className="shrink-0 rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {STATUS_WORD[listing.status]}
            </span>
          </div>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-mark text-lg font-bold tracking-mark">
              {formatPrice(listing.priceDay)}
            </span>
            <span className="text-sm text-muted-foreground">
              в сутки · {formatDeposit(listing.depositType, listing.depositAmount)}
              {listing.quantity > 1 ? ` · ${listing.quantity} шт.` : ""}
            </span>
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <Link
              href={`${selfHref}?tab=edit` as never}
              className="rounded-sm border border-border px-2.5 py-1 hoverable"
            >
              Править
            </Link>
            {/* Витрина только у активного: у скрытого и архивного публичной
              * страницы нет, ссылка вела бы в 404. */}
            {listing.status === "active" && (
              <Link
                href={publicHref as never}
                className="rounded-sm border border-border px-2.5 py-1 hoverable"
              >
                Смотреть на витрине
              </Link>
            )}
            {/* Скрыть, показать, убрать в архив — тем же меню, что в списке.
              * Без него страница вещи не умела единственного, что умеет список,
              * и «всё про вещь в одном месте» было неправдой. */}
            <ListingRowActions
              listingId={listing.id}
              status={listing.status}
              title={listing.title}
              publicHref={publicHref}
            />
          </p>
        </div>
      </header>

      {/* На десктопе две колонки: занятость уезжает в правую, потому что
        * календарь имеет свою естественную ширину и в широкой колонке оставлял
        * полэкрана пустыми. На мобиле всё встаёт в столбец, и занятость идёт
        * после заявок — у них горит срок, у занятости нет. */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="заявки" count={requests.length}>
            {requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">Заявок на эту вещь пока не было.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {requests.map((row) => (
                  <li
                    key={row.id}
                    className={`rounded-lg border p-3.5 ${
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
                      <span className={`shrink-0 rounded-sm px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASSES[row.status]}`}>
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
          </Panel>

          <Panel title="переписки" count={threads.length}>
            {threads.length === 0 ? (
              <p className="text-sm text-muted-foreground">По этой вещи вам ещё не писали.</p>
            ) : (
              <ul className="-mx-1 flex flex-col">
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
          </Panel>
        </div>

        {!isArchived && (
          <Panel title="занятость">
            {/* Строкой — то, ради чего сюда чаще всего заходят: свободна ли вещь
              * и когда ближайшая занятость. Сетка ниже отвечает на другой
              * вопрос, «что там дальше по месяцу», и нужна реже. */}
            <p className="mb-3 text-sm">
              {summary.nextBusyFrom === null ? (
                "Ближайший месяц свободен целиком."
              ) : (
                <>
                  Занятость есть в {summary.busyDays} {ruPlural(summary.busyDays, "дне", "днях", "днях")} ближайшего месяца.
                  {" "}
                  <span className="text-muted-foreground">
                    Ближайшая занятость: {summary.nextBusyFrom === summary.nextBusyTo
                      ? formatDayMonth(summary.nextBusyFrom)
                      : `${formatDayMonth(summary.nextBusyFrom)} — ${formatDayMonth(summary.nextBusyTo!)}`}.
                  </span>
                </>
              )}
            </p>
            <ListingAvailability
              listingId={listing.id}
              quantity={listing.quantity}
              availability={Object.fromEntries(map)}
              today={from}
              maxDate={horizon}
            />
          </Panel>
        )}
      </div>
    </main>
  );
}

/* Блок страницы вещи. Общая подложка и общий заголовок: до этого шапка, заявки,
 * занятость и переписки были огорожены четырьмя разными способами — от голого
 * текста до списка с разделителями, — и страница выглядела собранной наспех. */
function Panel({
  title, count, children,
}: {
  title: string;
  /** Число рядом с заголовком. Не показывается, когда считать нечего. */
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="surface p-4 sm:p-5">
      <h3 className="mb-3 font-mono text-2xs uppercase tracking-mono text-muted-foreground">
        {title}
        {count !== undefined && <span className="ml-1.5 text-foreground">{count}</span>}
      </h3>
      {children}
    </section>
  );
}
