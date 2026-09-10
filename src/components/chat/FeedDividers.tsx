// Разделители внутри ленты и запись о сделке. Все — <li>, потому что лента это
// <ol>: див между пунктами даёт невалидную разметку и врёт скринридеру о числе
// элементов.

import { ruPlural } from "@/lib/plural";
import { content } from "@theme/content";
import { systemMessageText, type ChatSystemKind, type ChatSystemMeta } from "@/lib/chat/system-message";

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

/* Запись о сделке: подтверждение, отказ, отмена. Не пузырь и не разделитель —
 * посередине ленты, приглушённой плашкой. Пузырь тут неверен по существу: у
 * записи нет стороны, и любой из двух рисунков приписал бы её человеку.
 *
 * Текста в базе нет, он собирается из вида и meta — см. lib/chat/system-message. */
export function SystemNote({
  message,
}: {
  message: { kind: string; meta: ChatSystemMeta | null };
}) {
  const { title, detail } = systemMessageText(message.kind as ChatSystemKind, message.meta);
  return (
    <li className="my-1.5 flex justify-center">
      <span className="max-w-[80%] rounded-sm bg-muted px-3 py-1.5 text-center text-xs text-muted-foreground">
        {title}
        {detail && <span className="ml-1.5 whitespace-nowrap tabular-nums">{detail}</span>}
      </span>
    </li>
  );
}
