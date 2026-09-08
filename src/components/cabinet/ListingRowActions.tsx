"use client";

// Действия по объявлению в списке — одним меню. Раньше это были три безымянные
// иконки поверх фотографии: подписей не было, места на четвёртую не было тоже,
// и «Смотреть на витрине» в кабинет так и не попало.
//
// Меню то же самое, что под аватаркой в шапке, — второго вида выпадающих
// списков в проекте быть не должно.

import Link from "next/link";
import { useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { setListingStatus } from "@/server/actions/owner";

const TRIGGER =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-muted-foreground "
  + "transition-colors hoverable hover:text-foreground focus-visible:[outline:none] "
  + "focus-visible:ring-2 focus-visible:ring-ring";

export function ListingRowActions({
  listingId, status, title, publicHref,
}: {
  listingId: string;
  status: "active" | "hidden" | "archived";
  /** Нужен подписям: без него «Скрыть» у десяти строк читается одинаково. */
  title: string;
  /** Адрес на витрине. null, когда города уже нет в справочнике активных. */
  publicHref: string | null;
}) {
  const [, startTransition] = useTransition();

  const run = (next: "active" | "hidden" | "archived") =>
    startTransition(async () => { await setListingStatus(listingId, next); });

  // Подтверждение ждёт настоящего ответа, поэтому экшен зовётся напрямую, без
  // useTransition: тот возвращается сразу, и окно закрывалось бы до ответа
  // сервера. Отказ выбрасывается — ConfirmDialog оставит окно открытым.
  const confirmArchive = async () => {
    const r = await setListingStatus(listingId, "archived");
    if (!r.ok) throw new Error("Не удалось убрать объявление. Попробуйте ещё раз.");
  };

  const isActive = status === "active";

  return (
    <DropdownMenu>
      {/* Триггер НЕ гасим на время запроса. Radix при закрытии возвращает
        * фокус на него, а focus() по disabled-кнопке — пустая операция: фокус
        * уезжает в body, и Tab начинает с шапки страницы. Защищать тут нечего —
        * меню уже закрыто, а setListingStatus идемпотентен. */}
      <DropdownMenuTrigger
        className={TRIGGER}
        aria-label={`Действия: ${title}`}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[200px]">
        {status === "archived" ? (
          <DropdownMenuItem onSelect={() => run("hidden")}>
            Вернуть из архива
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem asChild>
              <Link href={`/cabinet/listings/${listingId}?tab=edit` as never}>Править</Link>
            </DropdownMenuItem>

            {/* Витрина только у активного: у скрытого публичной страницы нет,
              * пункт вёл бы в 404. */}
            {isActive && publicHref && (
              <DropdownMenuItem asChild>
                <Link href={publicHref as never}>Смотреть на витрине</Link>
              </DropdownMenuItem>
            )}

            <DropdownMenuItem onSelect={() => run(isActive ? "hidden" : "active")}>
              {isActive ? "Скрыть" : "Показать"}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <ConfirmDialog
              trigger={
                // onSelect гасится: иначе Radix закрыл бы меню раньше, чем
                // откроется окно подтверждения, и триггер размонтировался бы.
                <DropdownMenuItem
                  className="text-destructive"
                  onSelect={(e) => e.preventDefault()}
                >
                  В архив
                </DropdownMenuItem>
              }
              title="Убрать объявление?"
              description={
                "Объявление пропадёт из каталога и из этого списка, но останется в архиве — "
                + "оттуда его можно вернуть. Заявки и переписка по нему сохранятся, а вот "
                + "занятость у архивной вещи больше не показывается, даже если бронь ещё идёт."
              }
              confirmLabel="Убрать"
              destructive
              onConfirm={confirmArchive}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
