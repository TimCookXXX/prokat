// Кабинет покупателя: мои заявки на бронь. Protected route (middleware
// редиректит анонимов на /login, страница перепроверяет сессию сама).

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthState } from "@/lib/auth/guard";
import { getCustomerRequests } from "@/server/booking";
import { listingPath } from "@/lib/catalog/listing-path";
import { canTransition, type BookingStatus } from "@/lib/catalog/booking-status";
import { STATUS_BADGE_CLASSES, STATUS_LABELS } from "@/lib/booking/status-labels";
import { formatDayMonth } from "@/lib/catalog/dates";
import { CancelRequestButton } from "@/components/booking/CancelRequestButton";
import { requireP2P } from "@/lib/features";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Мои заявки",
  robots: { index: false },
};

export default async function RequestsPage() {
  requireP2P();
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/requests");

  const rows = await getCustomerRequests(session.user.id);

  return (
    <section aria-label="Мои заявки">
      {rows.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">
          Пока нет заявок. Найдите нужную вещь в каталоге и выберите даты.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map(({ request, listingTitle, listingSlug, listingId, categorySlug, citySlug, ownerName, ownerUsername, ownerPhone }) => {
            const status = request.status as BookingStatus;
            const period = request.dateFrom === request.dateTo
              ? formatDayMonth(request.dateFrom)
              : `${formatDayMonth(request.dateFrom)} — ${formatDayMonth(request.dateTo)}`;
            const sellerLabel = ownerName ?? "Продавец";
            return (
              <li key={request.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={listingPath(citySlug, categorySlug, listingSlug, listingId) as never}
                      className="font-medium hover:underline underline-offset-2"
                    >
                      {listingTitle}
                    </Link>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {period}
                      {request.qty > 1 ? ` · ${request.qty} шт.` : ""}
                      {" · "}
                      {ownerUsername ? (
                        <Link href={`/u/${ownerUsername}` as never} className="hover:text-foreground">
                          {sellerLabel}
                        </Link>
                      ) : sellerLabel}
                    </p>
                  </div>
                  <span className={`rounded-pill px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASSES[status]}`}>
                    {STATUS_LABELS[status]}
                  </span>
                </div>

                {status === "new" && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Продавец обычно созванивается для подтверждения. Заявка
                    действует до {request.expiresAt.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.
                  </p>
                )}
                {status === "confirmed" && ownerPhone && (
                  <p className="mt-2 text-sm">
                    Телефон продавца:{" "}
                    <a href={`tel:${ownerPhone.replace(/[^+\d]/g, "")}`} className="font-medium hover:underline">
                      {ownerPhone}
                    </a>
                  </p>
                )}
                {request.ownerComment && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Комментарий продавца: {request.ownerComment}
                  </p>
                )}

                {canTransition(status, "cancelled") && (
                  <div className="mt-3 flex justify-end">
                    <CancelRequestButton requestId={request.id} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
