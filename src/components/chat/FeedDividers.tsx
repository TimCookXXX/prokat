// Разделители внутри ленты и запись о сделке. Все — <li>, потому что лента это
// <ol>: див между пунктами даёт невалидную разметку и врёт скринридеру о числе
// элементов.

import { Fragment } from "react";
import Link from "next/link";
import { ruPlural } from "@/lib/plural";
import { content } from "@theme/content";
import {
  requestNoteRows, systemMessageText,
  type ChatSystemKind, type ChatSystemMeta,
} from "@/lib/chat/system-message";

// Линии по бокам, а не одна капсула: без них подпись висит в воздухе и не
// читается как граница дня. Handoff описывал только капсулу — отклонение
// сознательное, по просьбе заказчика.
export function DateDivider({ label }: { label: string }) {
  return (
    <li className="my-2 flex items-center gap-3">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="rounded-pill bg-muted px-3 py-1 font-mono text-micro uppercase tracking-mono text-muted-foreground">
        {label}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </li>
  );
}

export function UnreadDivider({ count }: { count: number }) {
  return (
    <li className="my-1 flex items-center gap-3" aria-label={`${content.chat.unreadDivider}: ${count}`}>
      <span aria-hidden="true" className="h-px flex-1 bg-accent/30" />
      <span className="font-mono text-micro uppercase tracking-mono text-accent">
        {content.chat.unreadDivider} · {count} {ruPlural(count, "новое", "новых", "новых")}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-accent/30" />
    </li>
  );
}

/* Запись о сделке. Не пузырь и не разделитель — посередине ленты, приглушённой
 * подложкой. Пузырь тут неверен по существу: у записи нет стороны, и любой из
 * двух рисунков приписал бы её человеку.
 *
 * Рисунков два. Заявка — карточкой со списком условий: это единственная
 * запись, у которой есть что перечислять, и ради неё человек в тред и придёт.
 * Решения по ней остаются плашкой: перечислять нечего, а четыре одинаковые
 * карточки подряд забили бы ленту.
 *
 * Текста в базе нет, он собирается из вида и meta — см. lib/chat/system-message. */
export function SystemNote({
  message,
}: {
  message: { kind: string; meta: ChatSystemMeta | null };
}) {
  const kind = message.kind as ChatSystemKind;
  const { title, detail, comment } = systemMessageText(kind, message.meta);

  if (kind === "request_created") {
    return <RequestNote title={title} meta={message.meta} comment={comment} />;
  }

  return (
    <li className="my-1.5 flex justify-center">
      <span className="flex max-w-[80%] flex-col items-center gap-1 rounded-sm bg-muted px-3 py-1.5 text-center text-xs text-muted-foreground">
        {/* Перенос разрешён только МЕЖДУ названием события и его датами:
          * «Заявка на / бронь» рвёт фразу, а неразрывная строка целиком
          * распирает плашку до краёв экрана. Каждая часть неразрывна, шов
          * между ними — свободен. */}
        <span className="flex flex-wrap justify-center gap-x-1.5">
          <span className="whitespace-nowrap">{title}</span>
          {detail && <span className="whitespace-nowrap tabular-nums">{detail}</span>}
        </span>
        {/* Комментарий — своей строкой и в кавычках: это чужие слова внутри
          * служебной записи, и слипаться с ней они не должны. Переносится
          * свободно, в отличие от дат. */}
        {comment && <span className="text-foreground">«{comment}»</span>}
      </span>
    </li>
  );
}

/* Карточка заявки. Подложка muted, а не card: панель переписки сама стоит на
 * card, и карточка на нём была бы белым по белому с волоском рамки.
 *
 * Потолок ширины свой, а не унаследованные у плашки 80%: на 360px это 265px, и
 * список в две колонки туда не встаёт. Заявка — самая широкая запись в ленте,
 * ей и полагается собственная мера.
 *
 * Ведёт в шторку заявки: живого статуса у записи нет и быть не может — она
 * про момент, а не про «сейчас» (ADR 0017). Ссылка отвечает на «а что с ней
 * стало» единственным честным способом — показывает саму заявку. */
function RequestNote({
  title, meta, comment,
}: {
  title: string;
  meta: ChatSystemMeta | null;
  comment: string | null;
}) {
  const rows = requestNoteRows(meta);
  const requestId = meta?.requestId;

  const card = (
    <span className="flex w-full flex-col gap-2 rounded-sm bg-muted px-3.5 py-3 text-left">
      <span className="text-xs font-semibold text-foreground">{title}</span>
      {rows.length > 0 && (
        <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {rows.map((r) => (
            <Fragment key={r.term}>
              <span className="text-muted-foreground">{r.term}</span>
              <span className="tabular-nums text-foreground">{r.value}</span>
            </Fragment>
          ))}
        </span>
      )}
      {comment && (
        <span className="border-l-2 border-border pl-2.5 text-xs text-foreground">
          {comment}
        </span>
      )}
    </span>
  );

  return (
    <li className="my-2 flex justify-center">
      <span className="w-[min(22rem,92%)]">
        {requestId ? (
          <Link
            href={`/cabinet/requests?request=${requestId}` as never}
            className="block rounded-sm transition-opacity hover:opacity-80"
          >
            {card}
          </Link>
        ) : card}
      </span>
    </li>
  );
}
