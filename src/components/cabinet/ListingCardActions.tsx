"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Eye, EyeOff, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { setListingStatus } from "@/server/actions/owner";

// Кнопки поверх фотографии карточки кабинета.
//
// Не на Button: варианты кнопки тащат hover:text-foreground, а он по
// специфичности перебивает цвет из .glass-photo — в светлой теме иконка
// становилась бы почти чёрной на тёмном стекле. Тот же приём уже используют
// плашка продавца в выдаче и кнопки на обложке профиля: голый элемент со
// стеклом и hover:opacity-90.
//
// 36px на мобиле — меньше 44px из таб-бара, и это осознанно: три кнопки с
// зазорами занимают 116px при доступных 120 на экране 320px. Кнопки здесь
// вторичные, основная цель клика — сама карточка.
const BTN =
  "glass-photo inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full " +
  "transition-opacity hover:opacity-90 focus-visible:[outline:none] focus-visible:ring-2 " +
  "focus-visible:ring-ring sm:h-10 sm:w-10 disabled:opacity-60";

const ICON = "h-4 w-4";

export function ListingCardActions({
  listingId, status, title,
}: {
  listingId: string;
  status: "active" | "hidden" | "archived";
  /** Нужен подписям: без него «Скрыть» в списке из десяти карточек одинаковы. */
  title: string;
}) {
  const [pending, startTransition] = useTransition();

  const run = (next: "active" | "hidden" | "archived") =>
    startTransition(async () => { await setListingStatus(listingId, next); });

  // Подтверждение ждёт настоящего ответа, поэтому экшен зовётся напрямую, без
  // useTransition: тот возвращается сразу, и окно закрывалось бы до того, как
  // сервер ответил. Отказ выбрасывается — ConfirmDialog оставит окно открытым
  // и покажет причину.
  const confirmArchive = async () => {
    const r = await setListingStatus(listingId, "archived");
    if (!r.ok) throw new Error("Не удалось убрать объявление. Попробуйте ещё раз.");
  };

  if (status === "archived") {
    return (
      <button
        type="button"
        className={BTN}
        disabled={pending}
        aria-label={`Вернуть из архива: ${title}`}
        title="Вернуть из архива"
        onClick={() => run("hidden")}
      >
        <RotateCcw className={ICON} aria-hidden="true" />
      </button>
    );
  }

  const isActive = status === "active";

  return (
    <>
      <Link href={`/cabinet/listings/${listingId}?tab=edit`} className={BTN} aria-label={`Править: ${title}`} title="Править">
        <Pencil className={ICON} aria-hidden="true" />
      </Link>

      <button
        type="button"
        className={BTN}
        disabled={pending}
        aria-label={isActive ? `Скрыть: ${title}` : `Показать: ${title}`}
        title={isActive ? "Скрыть" : "Показать"}
        onClick={() => run(isActive ? "hidden" : "active")}
      >
        {isActive
          ? <EyeOff className={ICON} aria-hidden="true" />
          : <Eye className={ICON} aria-hidden="true" />}
      </button>

      <ConfirmDialog
        trigger={
          <button type="button" className={BTN} aria-label={`Удалить: ${title}`} title="Удалить">
            <Trash2 className={ICON} aria-hidden="true" />
          </button>
        }
        title="Убрать объявление?"
        description={
          "Объявление пропадёт из каталога и из этого списка, но останется в архиве — "
          + "оттуда его можно вернуть. Заявки и переписка по нему сохранятся, а вот в "
          + "календарь занятости оно больше не попадёт, даже если бронь ещё идёт."
        }
        confirmLabel="Убрать"
        destructive
        onConfirm={confirmArchive}
      />
    </>
  );
}
