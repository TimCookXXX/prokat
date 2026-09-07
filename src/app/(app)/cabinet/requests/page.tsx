// Лента заявок обеих ролей. Роль — фильтр, а не раздел: человек в C2C сдаёт и
// арендует одновременно, и разделение по ролям заставляло его вспоминать, кто
// он в этой сделке, прежде чем понять, куда идти.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { CountersSync } from "@/components/realtime/CountersSync";
import { requireAuthState } from "@/lib/auth/guard";
import { getCabinetRequests } from "@/server/cabinet";
import { listingPath } from "@/lib/catalog/listing-path";
import { STATUS_BADGE_CLASSES, STATUS_LABELS } from "@/lib/booking/status-labels";
import { formatDayMonth } from "@/lib/catalog/dates";
import { RequestActions } from "@/components/cabinet/RequestActions";
import type { RequestSide } from "@/lib/booking/request-access";
import {
  markRequestNotificationsSeen, purgeReadNotifications,
} from "@/server/notifications";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Заявки", robots: { index: false } };

// Значение приходит из адреса: строкой, массивом при повторе ключа или мусором.
// Всё, что не роль, — это «обе», а не ошибка: фильтр не должен ронять страницу.
function parseRole(raw: string | string[] | undefined): RequestSide | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "owner" || value === "customer" ? value : undefined;
}

const FILTERS = [
  { role: undefined, label: "Все" },
  { role: "owner" as const, label: "Я сдаю" },
  { role: "customer" as const, label: "Я арендую" },
];

export default async function CabinetRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string | string[] }>;
}) {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/cabinet/requests");

  const role = parseRole((await searchParams).role);

  // Гасим ровно те стороны, что человек увидел. Гасить обе безусловно нельзя:
  // зайдя с фильтром «я сдаю», он погасил бы события по своим заявкам, которых
  // на экране не было.
  const shownSides: RequestSide[] = role ? [role] : ["owner", "customer"];
  for (const side of shownSides) {
    await markRequestNotificationsSeen(session.user.id, side);
  }
  await purgeReadNotifications();

  const rows = await getCabinetRequests(session.user.id, { role });

  return (
    <section aria-label="Заявки на бронь">
      <CountersSync />

      <nav aria-label="Фильтр по роли" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = f.role === role;
          return (
            <Link
              key={f.label}
              href={(f.role ? `/cabinet/requests?role=${f.role}` : "/cabinet/requests") as never}
              aria-current={active ? "page" : undefined}
              className={`rounded-pill border px-3 py-1.5 text-sm ${
                active
                  ? "border-selected bg-selected text-selected-foreground"
                  : "border-border text-muted-foreground hoverable"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <EmptyState>
          {role === "owner"
            ? "Заявок на ваши вещи пока нет. Они появятся здесь, когда кто-то выберет даты."
            : role === "customer"
              ? "Вы пока ничего не бронировали. Найдите нужную вещь в каталоге и выберите даты."
              : "Заявок пока нет — ни на ваши вещи, ни от вас."}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const { status, side } = row;
            const owner = side === "owner";
            const period = row.dateFrom === row.dateTo
              ? formatDayMonth(row.dateFrom)
              : `${formatDayMonth(row.dateFrom)} — ${formatDayMonth(row.dateTo)}`;
            // Комментарий показываем чужой: свой человек и так помнит.
            const peerComment = owner ? row.customerComment : row.ownerComment;
            return (
              <li
                key={row.id}
                className={`rounded-lg border bg-card p-4 ${
                  owner && status === "new" ? "border-accent" : "border-border"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    {/* Роль — словом, а не цветом: цвет здесь уже занят
                      * срочностью, и второй смысл на него не вешается. */}
                    <p className="font-mono text-2xs uppercase tracking-mono text-muted-foreground">
                      {owner ? "вы сдаёте" : "вы арендуете"}
                    </p>
                    <Link
                      href={listingPath(
                        row.listing.citySlug,
                        row.listing.categorySlug,
                        row.listing.slug,
                        row.listing.id,
                      ) as never}
                      className="font-medium hover:underline underline-offset-2"
                    >
                      {row.listing.title}
                    </Link>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {period}
                      {row.qty > 1 ? ` · ${row.qty} шт.` : ""}
                      {" · "}
                      <Link href={`/u/${row.peer.id}` as never} className="hover:text-foreground">
                        {row.peer.name ?? (owner ? "клиент" : "продавец")}
                      </Link>
                    </p>
                  </div>
                  <span className={`rounded-sm px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASSES[status]}`}>
                    {STATUS_LABELS[status]}
                  </span>
                </div>

                {row.peerPhone && (
                  <p className="mt-2 text-sm">
                    {owner ? "Телефон клиента: " : "Телефон продавца: "}
                    <a href={`tel:${row.peerPhone.replace(/[^+\d]/g, "")}`} className="font-medium hover:underline">
                      {row.peerPhone}
                    </a>
                    {owner && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        Созвонитесь с клиентом, чтобы согласовать детали.
                      </span>
                    )}
                  </p>
                )}

                {peerComment && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {owner ? "Комментарий клиента: " : "Комментарий продавца: "}
                    {peerComment}
                  </p>
                )}

                {status === "new" && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {owner
                      ? "Действует до "
                      : "Продавец обычно созванивается для подтверждения. Заявка действует до "}
                    {row.expiresAt.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                    {owner ? ", потом истечёт автоматически." : "."}
                  </p>
                )}

                <div className="mt-3">
                  <RequestActions requestId={row.id} side={side} status={status} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
