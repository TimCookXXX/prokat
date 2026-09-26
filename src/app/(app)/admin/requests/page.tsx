import type { Metadata } from "next";
import { adminListRequests } from "@/server/admin";
import { STATUS_BADGE_CLASSES, STATUS_LABELS } from "@/lib/booking/status-labels";
import type { BookingStatus } from "@/lib/catalog/booking-status";
import { formatDayMonth } from "@/lib/catalog/dates";
import { requireP2P } from "@/lib/features";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Заявки — админка", robots: { index: false } };

export default async function AdminRequestsPage() {
  requireP2P();
  const rows = await adminListRequests();

  return (
    <section aria-label="Заявки">
      <p className="mb-4 text-sm text-muted-foreground">Последние {rows.length} заявок (просмотр)</p>
      <ul className="flex flex-col gap-2">
        {rows.map(({ request, listingTitle, ownerName, customerEmail }) => {
          const status = request.status as BookingStatus;
          return (
            <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{listingTitle}</p>
                <p className="text-sm text-muted-foreground">
                  {formatDayMonth(request.dateFrom)} — {formatDayMonth(request.dateTo)}
                  {request.qty > 1 ? ` · ${request.qty} шт.` : ""}
                  {" · "}{ownerName ?? "—"} · {customerEmail}
                  {" · "}{request.createdAt.toLocaleDateString("ru-RU")}
                </p>
              </div>
              <span className={`rounded-pill px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASSES[status]}`}>
                {STATUS_LABELS[status]}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
