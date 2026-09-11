"use client";

// Сводка кабинета одной панелью: все живые заявки обеих ролей в общей сетке.
//
// Трёх разделов («требует действия», «мои вещи в аренде», «я арендую») больше
// нет. Роль — подпись в строке, а не место, где строка лежит: человек в C2C
// сдаёт и арендует одновременно, и делить один список по ролям значило
// заставлять его вспоминать, кто он в этой сделке, прежде чем понять, куда
// смотреть (ADR 0015).
//
// Строка молчит, пока от человека ничего не нужно, и раскрывается ровно
// настолько, насколько нужно: ждущая ответа несёт сумму, залог, слова клиента,
// телефон и две кнопки; идущая — телефон и переписку; своя отправленная —
// только то, что ответа ещё нет. Что происходит с бронью сегодня, панель не
// пересказывает: даты стоят в строке, и подпись над ними была шумом.
//
// Раскладку переключает ширина САМОЙ панели, а не окна: рядом стоит сайдбар,
// и на 900px окна панели достаётся заметно меньше. Правила — в globals.css,
// класс .summary-panel: контейнерных запросов в тейлвинде этого проекта нет.

import Link from "next/link";
import { MessageCircle, Phone } from "lucide-react";
import { RequestActions } from "@/components/cabinet/RequestActions";
import {
  period, roleWord, StatusBadge, Thumb, TimeLeft, type FeedRow,
} from "@/components/cabinet/request-row-bits";
import { requestListingHref } from "@/lib/booking/listing-link";
import { depositValue, formatPrice } from "@/lib/catalog/format";
import { rentalDaysCount } from "@/lib/booking/params";
import { ruPlural } from "@/lib/plural";
import { Button } from "@/components/ui/button";

/* Телефон ссылкой, а не кнопкой. Он не действие рядом с «Подтвердить», а то,
 * ЧЕМ решение принимается: по правилам сервиса оно принимается созвоном. Кнопка
 * во всю ширину отнимала у строки целую полосу — на телефоне это половина её
 * высоты, — и уравнивала справку с решением. */
function PhoneLink({ phone }: { phone: string }) {
  return (
    <p className="summary-phone">
      <a
        href={`tel:${phone.replace(/[^+\d]/g, "")}`}
        className="inline-flex items-center gap-1.5 tabular-nums hover:text-accent"
      >
        <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {phone}
      </a>
    </p>
  );
}

function ChatButton({ row }: { row: FeedRow }) {
  if (!row.threadId) return null;
  const n = row.unread ?? 0;
  return (
    <Button asChild size="icon" variant="ghost" className="summary-chat">
      <Link href={`/chat/${row.threadId}` as never} aria-label={
        n > 0 ? `Переписка, ${n} ${ruPlural(n, "новое", "новых", "новых")}` : "Переписка"
      }>
        <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {n > 0 && (
          /* Счётчик внутри кнопки, а не рядом: это один объект — «переписка, в
           * ней столько-то нового», — а не число и кнопка по отдельности.
           * Рецепт бейджа взят у навигации кабинета, а не изобретён: охра по
           * охряному тинту не проходит по контрасту (ADR 0008). */
          <span
            aria-hidden="true"
            className="flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-accent px-1 text-[11px] font-bold tabular-nums text-accent-foreground"
          >
            {n > 9 ? "9+" : n}
          </span>
        )}
      </Link>
    </Button>
  );
}

function Row({ row }: { row: FeedRow }) {
  const owner = row.side === "owner";
  const decide = owner && row.status === "new";
  const href = requestListingHref(row.listing, row.side);
  const days = rentalDaysCount({ from: row.dateFrom, to: row.dateTo, qty: row.qty });

  return (
    <li className={`summary-row${row.hot ? " summary-row--hot" : ""}`}>
      <span className="summary-thumb">
        <Thumb row={row} size={36} />
      </span>

      <div className="summary-body">
        <p className="summary-title">
          {href ? (
            <Link href={href as never} className="transition-colors hover:text-accent">
              {row.listing.title}
            </Link>
          ) : row.listing.title}
        </p>
        <p className="summary-meta">
          <span className="font-mono text-2xs uppercase tracking-mono">{roleWord(row)}</span>
          {" · "}
          {/* Период в строке только на узкой панели: на широкой он стоит
            * отдельной колонкой, и повторять его здесь незачем. */}
          <span className="summary-narrow tabular-nums">{period(row)} · </span>
          {row.peer.name ?? (owner ? "клиент" : "продавец")}
        </p>

        {/* Деньги и слова человека — только там, где решение за вами: на
          * идущей аренде решать нечего, и строка молчит. */}
        {decide && (
          <>
            <p className="summary-money tabular-nums">
              {row.estimate !== null && <>≈ {formatPrice(row.estimate)} </>}
              <span>
                за {days} {ruPlural(days, "день", "дня", "дней")}
                {row.qty > 1 && ` · ${row.qty} шт.`}
                {" · залог "}{depositValue(row.depositType, row.depositAmount).toLowerCase()}
              </span>
            </p>
            {row.customerComment && (
              <p className="summary-quote">{row.customerComment}</p>
            )}
          </>
        )}

      </div>

      {/* Подвал строки: телефон и переписка. На узкой панели они стоят одной
        * строкой, на широкой контейнер растворяется (display: contents) и оба
        * встают в сетку сами — так один и тот же узел разметки живёт в двух
        * раскладках без копии. */}
      <div className="summary-foot">
        {row.peerPhone && <PhoneLink phone={row.peerPhone} />}
        <ChatButton row={row} />
      </div>

      <p className="summary-when tabular-nums">
        {period(row)}
        {days > 0 && <span className="summary-days">{days} {ruPlural(days, "день", "дня", "дней")}</span>}
      </p>

      <p className="summary-sig">
        {decide && <TimeLeft row={row} />}
        {!owner && row.status === "new" && <StatusBadge row={row} />}
      </p>

      {/* В колонке управления теперь только решения. Справка (телефон,
        * переписка) переехала в тело и в угол строки: уравнивать её с
        * «Подтвердить» размером кнопки было неверно. */}
      {decide && (
        <div className="summary-ctl">
          <RequestActions
            requestId={row.id} side={row.side} status={row.status}
            dateFrom={row.dateFrom} place="panel"
          />
        </div>
      )}
    </li>
  );
}

export function SummaryPanel({
  rows, rest,
}: {
  rows: FeedRow[];
  /** Сколько живых заявок не поместилось. Число точное — резали в памяти. */
  rest: number;
}) {
  if (rows.length === 0) {
    return (
      <div className="summary-panel">
        <div className="summary-empty">
          <h2 className="font-display text-lg font-bold">Ничего не ждёт ответа</h2>
          <p className="mt-1.5 max-w-[48ch] text-sm text-muted-foreground">
            Здесь будет всё живое: и заявки на ваши вещи, и те, что отправили вы.
          </p>
          <div className="mt-3.5 flex flex-wrap gap-2">
            <Button asChild>
              <Link href={"/cabinet/listings/new" as never}>Разместить вещь</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={"/" as never}>Что сдают рядом</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ol className="summary-panel" role="list" aria-label="Живые заявки">
      {rows.map((r) => <Row key={r.id} row={r} />)}
      {rest > 0 && (
        <li>
          <Link href={"/cabinet/requests" as never} className="summary-more">
            Ещё {rest} {ruPlural(rest, "заявка", "заявки", "заявок")} →
          </Link>
        </li>
      )}
    </ol>
  );
}
