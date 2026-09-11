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
// только то, что ответа ещё нет.
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

/* Что сегодня происходит с этой бронью. Считается от дня, посчитанного НА
 * СЕРВЕРЕ и переданного строкой: «сегодня» на полуночной границе у сервера и
 * у браузера разное, а панель попадает в SSR — вычисляй мы его здесь, React
 * ругался бы на расхождение разметки. */
function todayNote(row: FeedRow, today: string): string | null {
  if (row.status !== "confirmed") return null;
  const owner = row.side === "owner";
  // Аренда на одни сутки: сегодня и отдать, и забрать обратно. Два события в
  // один день — это и есть ответ, а не повод назвать одно из них.
  if (row.dateFrom === today && row.dateTo === today) {
    return owner ? "сегодня отдать и принять" : "сегодня забрать и вернуть";
  }
  if (row.dateFrom === today) return owner ? "сегодня отдать" : "сегодня забрать";
  if (row.dateTo === today) return owner ? "сегодня возврат" : "сегодня вернуть";
  return null;
}

function PhoneButton({ phone }: { phone: string }) {
  return (
    <Button asChild size="default" variant="outline" className="summary-phone">
      <a href={`tel:${phone.replace(/[^+\d]/g, "")}`}>
        <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate tabular-nums">{phone}</span>
      </a>
    </Button>
  );
}

function ChatButton({ row }: { row: FeedRow }) {
  if (!row.threadId) return null;
  const n = row.unread ?? 0;
  return (
    <Button asChild size="icon" variant="outline" className="summary-chat">
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

function Row({ row, today }: { row: FeedRow; today: string }) {
  const owner = row.side === "owner";
  const decide = owner && row.status === "new";
  const href = requestListingHref(row.listing, row.side);
  const days = rentalDaysCount({ from: row.dateFrom, to: row.dateTo, qty: row.qty });
  const note = todayNote(row, today);

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
            {row.peerPhone && (
              /* Телефон здесь, а не среди кнопок: правило сервиса — решение по
               * заявке принимается созвоном, значит номер это ВХОД в решение, а
               * не третье действие рядом с ним. В колонке управления он вдобавок
               * вытеснял «Подтвердить» и «Отклонить» за её край. */
              <p className="summary-money">
                <a
                  href={`tel:${row.peerPhone.replace(/[^+\d]/g, "")}`}
                  className="inline-flex items-center gap-1.5 font-normal tabular-nums text-foreground hover:text-accent"
                >
                  <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {row.peerPhone}
                </a>
              </p>
            )}
            {row.customerComment && (
              <p className="summary-quote">{row.customerComment}</p>
            )}
          </>
        )}
      </div>

      <p className="summary-when tabular-nums">
        {period(row)}
        {days > 0 && <span className="summary-days">{days} {ruPlural(days, "день", "дня", "дней")}</span>}
      </p>

      <p className="summary-sig">
        {decide && <TimeLeft row={row} />}
        {note && (
          <span className="whitespace-nowrap rounded-sm bg-selected px-2 py-0.5 text-2xs font-semibold text-selected-foreground">
            {note}
          </span>
        )}
        {!owner && row.status === "new" && <StatusBadge row={row} />}
      </p>

      <div className="summary-ctl">
        {decide ? (
          <RequestActions
            requestId={row.id} side={row.side} status={row.status}
            dateFrom={row.dateFrom} place="panel"
          />
        ) : (
          <>
            {row.peerPhone && <PhoneButton phone={row.peerPhone} />}
            <ChatButton row={row} />
          </>
        )}
      </div>
    </li>
  );
}

export function SummaryPanel({
  rows, rest, today,
}: {
  rows: FeedRow[];
  /** Сколько живых заявок не поместилось. Число точное — резали в памяти. */
  rest: number;
  /** Деловой день, посчитанный на сервере: см. todayNote. */
  today: string;
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
      {rows.map((r) => <Row key={r.id} row={r} today={today} />)}
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
