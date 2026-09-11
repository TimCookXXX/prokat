"use client";

// Лента заявок: таблица от md, строки ниже, клик по строке открывает шторку с
// заявкой целиком. Столбца действий в списке нет — строка сама и есть кнопка,
// а решение принимается в шторке, рядом с телефоном и комментарием клиента:
// по правилам сервиса оно принимается созвоном, и номер должен быть под рукой
// в тот же момент.
//
// Открытая заявка живёт в адресе (?request=…): обновление её сохраняет,
// ссылку можно переслать, а «назад» закрывает шторку, не уводя со страницы.
// pushState/popstate — документированный приём Next, тот же, что у фильтра
// объявлений.

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Clock, ImageOff, MessageCircle } from "lucide-react";
import { Sheet, SheetBody, SheetFooter, SheetHeader } from "@/components/ui/Sheet";
import { RequestActions } from "@/components/cabinet/RequestActions";
import { STATUS_BADGE_CLASSES, STATUS_LABELS } from "@/lib/booking/status-labels";
import { requestListingHref } from "@/lib/booking/listing-link";
import { formatDayMonthNum, formatTimeLeft } from "@/lib/catalog/dates";
import { formatPrice } from "@/lib/catalog/format";
import type { CabinetRequestRow } from "@/server/cabinet";

export type FeedRow = Omit<CabinetRequestRow, "createdAt" | "expiresAt"> & {
  createdAt: string;
  expiresAt: string;
  /** Ждёт решения владельца-меня: карточке — охряная полоса и таймер. */
  hot: boolean;
  /** ≈ стоимость: сутки уже посчитаны сервером — там знает цену вещь. */
  estimate: number | null;
};

// Цифрами, не словами: период стоит парой, и «8 сентября — 14 сентября» не
// влезал ни в колонку таблицы, ни в строку на телефоне.
const period = (r: FeedRow) =>
  r.dateFrom === r.dateTo
    ? formatDayMonthNum(r.dateFrom)
    : `${formatDayMonthNum(r.dateFrom)} — ${formatDayMonthNum(r.dateTo)}`;

const roleWord = (r: FeedRow) => (r.side === "owner" ? "вы сдаёте" : "вы арендуете");

const isClosed = (r: FeedRow) =>
  r.status !== "new" && r.status !== "confirmed";

function Thumb({ row, size }: { row: FeedRow; size: number }) {
  return (
    <span
      className="relative shrink-0 overflow-hidden rounded-lg bg-muted"
      style={{ width: size, height: size }}
    >
      {row.listing.image ? (
        <Image src={row.listing.image} alt="" fill sizes={`${size}px`} className="object-cover" />
      ) : (
        <span className="flex h-full items-center justify-center text-muted-foreground">
          <ImageOff className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
    </span>
  );
}

function TimeLeft({ row }: { row: FeedRow }) {
  const left = formatTimeLeft(new Date(row.expiresAt));
  if (!left) return null;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm bg-selected px-2 py-0.5 text-2xs font-semibold text-selected-foreground">
      <Clock className="h-3 w-3" aria-hidden="true" />
      {/* SSR и гидрация считают от разных моментов: на минутной границе текст
        * расходится, и React шумел бы. */}
      <span suppressHydrationWarning>осталось {left}</span>
    </span>
  );
}

function StatusBadge({ row }: { row: FeedRow }) {
  return (
    <span className={`whitespace-nowrap rounded-sm px-2 py-0.5 text-2xs font-medium ${STATUS_BADGE_CLASSES[row.status]}`}>
      {STATUS_LABELS[row.status]}
    </span>
  );
}

/* Содержимое шторки. Кнопки решения — существующий RequestActions: у него уже
 * есть обе роли, комментарий и тексты ошибок, а два набора кнопок на одну
 * заявку неизбежно разъехались бы. */
function SheetContent({ row }: { row: FeedRow }) {
  const owner = row.side === "owner";
  const publicHref = requestListingHref(row.listing, row.side);
  /* Комментарий один — тот, что клиент оставил при заявке. Владельцу это
   * чужие слова в момент решения, арендатору — свои. Комментария владельца
   * больше нет: причину он пишет в переписке, где на неё можно ответить. */
  const peerComment = owner ? row.customerComment : null;
  const myComment = owner ? null : row.customerComment;

  return (
    <>
      <SheetHeader>
        <p className="font-mono text-2xs uppercase tracking-mono text-muted-foreground">
          {roleWord(row)}
        </p>
        <div className="mt-1.5 flex items-start gap-3 pr-8">
          <Thumb row={row} size={44} />
          <h2 className="min-w-0 break-words font-display text-lg font-bold leading-tight">
            {publicHref ? (
              <Link href={publicHref as never} className="transition-colors hover:text-accent">
                {row.listing.title}
              </Link>
            ) : row.listing.title}
          </h2>
        </div>
      </SheetHeader>

      <SheetBody>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Период</dt>
          <dd>{period(row)}{row.qty > 1 ? ` · ${row.qty} шт.` : ""}</dd>
          {row.estimate !== null && (
            <>
              <dt className="text-muted-foreground">Стоимость</dt>
              <dd>≈ {formatPrice(row.estimate)}</dd>
            </>
          )}
          <dt className="text-muted-foreground">{owner ? "Клиент" : "Продавец"}</dt>
          <dd>
            <Link href={`/u/${row.peer.id}` as never} className="hover:underline underline-offset-2">
              {row.peer.name ?? (owner ? "клиент" : "продавец")}
            </Link>
          </dd>
          {row.peerPhone && (
            <>
              <dt className="text-muted-foreground">Телефон</dt>
              <dd>
                <a href={`tel:${row.peerPhone.replace(/[^+\d]/g, "")}`} className="font-medium hover:underline">
                  {row.peerPhone}
                </a>
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Статус</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <StatusBadge row={row} />
            {row.status === "new" && <TimeLeft row={row} />}
          </dd>
        </dl>

        {peerComment && (
          <blockquote className="mt-4 border-l-2 border-border pl-3 text-sm text-muted-foreground">
            {peerComment}
          </blockquote>
        )}
        {myComment && (
          <p className="mt-3 text-xs text-muted-foreground">
            Ваш комментарий: {myComment}
          </p>
        )}

        {row.hot && (
          <p className="mt-4 text-xs text-muted-foreground">
            Не ответите — заявка закроется сама, и человек уйдёт к другому владельцу.
          </p>
        )}
        {!row.peerPhone && !owner && row.status === "new" && (
          <p className="mt-4 text-xs text-muted-foreground">
            Телефон продавца откроется, когда он подтвердит заявку.
          </p>
        )}

        {row.threadId && (
          <Link
            href={`/chat/${row.threadId}` as never}
            className="mt-4 inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            {owner ? "Написать клиенту" : "Написать продавцу"}
          </Link>
        )}
      </SheetBody>

      <SheetFooter>
        <RequestActions
          requestId={row.id} side={row.side} status={row.status} dateFrom={row.dateFrom}
        />
      </SheetFooter>
    </>
  );
}

export function RequestsFeed({
  rows,
  compact = false,
}: {
  rows: FeedRow[];
  /** Страница вещи: вещь и роль известны, колонка с ними — шум, а панель
   *  узкая — таблица в неё не встаёт. Всегда строки, первой идёт период. */
  compact?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("request");
  });
  // Закрывать через history.back() можно только запись, которую сами положили:
  // по прямой ссылке на заявку «назад» увёл бы со страницы.
  const pushed = useRef(false);

  const open = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("request", id);
    window.history.pushState(null, "", url);
    pushed.current = true;
    setOpenId(id);
  }, []);

  const close = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete("request");
      window.history.replaceState(null, "", url);
    }
    setOpenId(null);
  }, []);

  useEffect(() => {
    const sync = () => {
      pushed.current = false;
      setOpenId(new URLSearchParams(window.location.search).get("request"));
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const current = rows.find((r) => r.id === openId) ?? null;
  // Пока шторка закрывается, ей нужно что-то показывать — держим последнюю
  // открытую заявку: размонтировать сразу значит оборвать анимацию выхода.
  const lastShown = useRef<FeedRow | null>(null);
  if (current) lastShown.current = current;
  const shown = current ?? lastShown.current;

  const rowClass = (r: FeedRow) =>
    [
      "cursor-pointer transition-colors hoverable",
      r.hot ? "shadow-[inset_3px_0_0_var(--color-accent)]" : "",
      isClosed(r) ? "text-muted-foreground" : "",
    ].join(" ");

  if (compact) {
    return (
      <>
        <ul className="flex flex-col">
          {rows.map((row, i) => (
            <li key={row.id} className={i > 0 ? "border-t border-border" : ""}>
              <button
                type="button"
                onClick={() => open(row.id)}
                className={`flex w-full items-center gap-3 rounded-sm px-2 py-2.5 text-left focus-visible:[outline:none] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${rowClass(row)}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {period(row)}{row.qty > 1 ? ` · ${row.qty} шт.` : ""}
                  </span>
                  <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
                    {row.peer.name ?? "клиент"}
                  </span>
                </span>
                <StatusBadge row={row} />
              </button>
            </li>
          ))}
        </ul>
        {shown && (
          <Sheet
            open={current !== null}
            onOpenChange={(next) => { if (!next) close(); }}
            label={`Заявка: ${shown.listing.title}`}
          >
            <SheetContent row={shown} />
          </Sheet>
        )}
      </>
    );
  }

  return (
    <div className="surface">
      {/* Таблица от md: пять колонок помещаются уже рядом с сайдбаром кабинета,
        * потому что столбца действий нет. table-fixed и overflow-hidden — те же
        * причины, что в списке объявлений. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="[&>th]:px-3 [&>th]:py-2.5 [&>th]:text-left [&>th]:font-mono [&>th]:text-2xs [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-mono [&>th]:text-muted-foreground">
              <th scope="col">вещь</th>
              {/* Колонки «срок» нет намеренно: у подтверждённой он —
                * арифметика от периода, а срочность новой заявки уже несут
                * полоса, бейдж и сортировка. Точный таймер — в шторке, рядом
                * с кнопками решения. Ширина ушла названию вещи. */}
              <th scope="col" className="w-[112px]">период</th>
              <th scope="col" className="w-[120px]">кто</th>
              <th scope="col" className="w-[172px]">статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => open(row.id)}
                className={`border-t border-border ${rowClass(row)}`}
              >
                <td className="overflow-hidden px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <Thumb row={row} size={34} />
                    <span className="min-w-0 flex-1">
                      {/* Кнопкой служит вся строка; название — её доступное имя.
                        * Ссылки здесь нет: переходы лежат в шторке. */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); open(row.id); }}
                        className="block w-full truncate text-left font-semibold focus-visible:[outline:none] focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.listing.title}
                      </button>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {roleWord(row)}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-sm tabular-nums">
                  {period(row)}{row.qty > 1 ? ` · ${row.qty} шт.` : ""}
                </td>
                <td className="overflow-hidden truncate whitespace-nowrap px-3 py-2.5 text-sm">
                  {row.peer.name ?? (row.side === "owner" ? "клиент" : "продавец")}
                </td>
                <td className="px-3 py-2.5"><StatusBadge row={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Ниже md — строки. */}
      <ul className="md:hidden">
        {rows.map((row, i) => (
          <li key={row.id} className={i > 0 ? "border-t border-border" : ""}>
            <button
              type="button"
              onClick={() => open(row.id)}
              className={`flex w-full items-center gap-3 p-3 text-left focus-visible:[outline:none] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${rowClass(row)}`}
            >
              <Thumb row={row} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{row.listing.title}</span>
                <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
                  {roleWord(row)} · {period(row)} · {row.peer.name ?? "—"}
                </span>
              </span>
              <StatusBadge row={row} />
            </button>
          </li>
        ))}
      </ul>

      {shown && (
        <Sheet
          open={current !== null}
          onOpenChange={(next) => { if (!next) close(); }}
          label={`Заявка: ${shown.listing.title}`}
        >
          <SheetContent row={shown} />
        </Sheet>
      )}
    </div>
  );
}
