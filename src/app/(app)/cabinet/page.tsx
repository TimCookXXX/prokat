import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, ArrowRight } from "lucide-react";
import { requireAuthState } from "@/lib/auth/guard";
import { getCabinetSummary, type CabinetDeal } from "@/server/cabinet";
import { formatDayMonth, formatTimeLeft } from "@/lib/catalog/dates";
import { requestListingHref } from "@/lib/booking/listing-link";
import type { RequestSide } from "@/lib/booking/request-access";
import { Stats } from "@/components/cabinet/StatTile";
import { RequestActions } from "@/components/cabinet/RequestActions";
import { Button } from "@/components/ui/button";
import { ScrollReset } from "@/components/account/ScrollReset";

export const dynamic = "force-dynamic";

// Кабинет открывается сводкой, а не списком: пять разделов вручную обходить
// никто не станет, а срок горит только у входящих заявок.
export default async function CabinetIndex() {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/cabinet");

  const { pending, pendingTotal, lending, borrowing, stats } = await getCabinetSummary(session.user.id);
  const quiet = pending.length === 0 && lending.length === 0 && borrowing.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <ScrollReset />
      <Stats
        items={[
          { value: stats.views7d, label: "просмотров за неделю" },
          { value: stats.requests30d, label: "заявок за месяц" },
          { value: stats.activeListings, label: "активных объявлений" },
          { value: stats.busyDays30d, label: "дней занято впереди", accent: true },
        ]}
      />

      {pending.length > 0 && (
        <Section
          title="требует действия"
          note="срок горит только здесь"
          href="/cabinet/requests?role=owner"
          linkLabel={`Все заявки (${pendingTotal})`}
        >
          {pending.map((d) => (
            <PendingCard key={d.id} deal={d} />
          ))}
        </Section>
      )}

      {lending.length > 0 && (
        <Section
          title="мои вещи в аренде"
          note="делать ничего не нужно"
          href="/cabinet/requests"
          linkLabel="Все заявки"
        >
          {lending.map((d) => (
            <DealRow key={d.id} deal={d} peerPrefix="у" side="owner" />
          ))}
        </Section>
      )}

      {borrowing.length > 0 && (
        <Section
          title="я арендую"
          note="вернуть вовремя"
          href="/cabinet/requests?role=customer"
          linkLabel="Все мои заявки"
        >
          {borrowing.map((d) => (
            <DealRow key={d.id} deal={d} peerPrefix="от" side="customer" />
          ))}
        </Section>
      )}

      {quiet && (
        <div className="surface flex flex-col items-start gap-3 p-6">
          <p className="font-display text-lg font-bold">Всё разобрано</p>
          <p className="text-sm text-muted-foreground">
            Ни одной заявки со сроком. Когда кто-то захочет взять вашу вещь, она появится здесь.
          </p>
          <Button asChild>
            <Link href={"/cabinet/listings/new" as never}>Разместить ещё вещь</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function Section({
  title, note, href, linkLabel, children,
}: {
  title: string;
  note: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-mono text-2xs uppercase tracking-mono text-muted-foreground">{title}</h2>
        <span className="text-sm text-muted-foreground">{note}</span>
        <Link
          href={href as never}
          className="ml-auto inline-flex items-center gap-1 text-sm text-accent hover:underline"
        >
          {linkLabel}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

function peerLabel(deal: CabinetDeal): string {
  return deal.peerName ?? "человек";
}

function dates(deal: CabinetDeal): string {
  return `${formatDayMonth(deal.dateFrom)} — ${formatDayMonth(deal.dateTo)}`;
}

/* Заявка со сроком. Последствие названо прямо: без него непонятно, почему
 * это вообще стоит перед человеком.
 *
 * Решение принимается здесь же, а не «на той странице»: типичный случай — одна
 * горящая заявка, и переход ради двух кнопок был лишним шагом. Лента остаётся
 * для случая, когда их много. */
function PendingCard({ deal }: { deal: CabinetDeal }) {
  const left = formatTimeLeft(deal.expiresAt);

  return (
    <article className="surface flex flex-col gap-3 p-4">
      <div className="flex gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Bell className="h-5 w-5" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {peerLabel(deal)} просит {deal.listingTitle.toLowerCase()}
          </p>
          <p className="text-sm text-muted-foreground">
            {dates(deal)}
            {deal.qty > 1 && ` · ${deal.qty} шт.`}
            {left && ` · осталось ${left}`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Не ответите — заявка закроется сама, и человек уйдёт к другому владельцу.
          </p>
        </div>
      </div>

      {/* Сводка показывает только ждущие решения владельца, поэтому сторона и
        * статус здесь известны заранее. */}
      <RequestActions
        requestId={deal.id} side="owner" status="new" dateFrom={deal.dateFrom}
      />
    </article>
  );
}

function DealRow({
  deal, peerPrefix, side,
}: {
  deal: CabinetDeal;
  peerPrefix: string;
  /** Сторона известна секцией и решает, куда вести с убранной вещи. */
  side: RequestSide;
}) {
  const href = requestListingHref(deal.listing, side);
  return (
    <article className="surface flex flex-wrap items-center gap-x-4 gap-y-1 p-4">
      {/* Сделка подтверждена, но вещь могли убрать посреди аренды — ссылки
        * тогда может и не быть, см. lib/booking/listing-link. */}
      {href ? (
        <Link href={href as never} className="min-w-0 flex-1 font-medium hover:text-accent">
          {deal.listingTitle}
        </Link>
      ) : (
        <p className="min-w-0 flex-1 font-medium">{deal.listingTitle}</p>
      )}
      <span className="text-sm text-muted-foreground">{dates(deal)}</span>
      <span className="text-sm text-muted-foreground">
        {peerPrefix} {peerLabel(deal)}
      </span>
    </article>
  );
}
