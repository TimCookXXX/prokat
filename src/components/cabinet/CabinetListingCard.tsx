import Link from "next/link";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { listingPhotos, type Listing } from "@/server/catalog";
import { formatDeposit, formatPrice } from "@/lib/catalog/format";
import { freeQty, type AvailabilityMap } from "@/lib/catalog/availability";
import { cardFrame } from "@/components/ui/card-frame";

const STATUS_LABEL: Record<Listing["status"], string> = {
  active: "Активно",
  hidden: "Скрыто",
  archived: "Архив",
};

// Карточка объявления в кабинете. Вид тот же, что на витрине (общая рамка из
// ui/card-frame), смысл другой: вместо плашки продавца — статус, вместо подвала
// со способом получения — органы управления.
//
// Кнопки статуса приходят пропом, а не импортируются: они тянут server action,
// а через него next-auth, и карточка перестала бы рендериться в тестах. Так она
// остаётся чистым видом.
export function CabinetListingCard({
  listing, availabilityMap, from, actions,
}: {
  listing: Listing;
  /** Занятость на сегодня. Пустая карта у неактивных — плашку им не рисуем. */
  availabilityMap: AvailabilityMap;
  from: string;
  /** Кнопки действий. Рисуются поверх фото; живут на странице — см. выше. */
  actions: React.ReactNode;
}) {
  const photo = listingPhotos(listing)[0];
  const price = formatPrice(listing.priceDay);
  // Карточка ведёт на страницу вещи — и у активного тоже. Занятость, заявки и
  // переписки по вещи живут там, и это единственный вход в неё: карандаш ведёт
  // сразу в форму. На витрину ссылка есть уже со страницы вещи.
  const href = `/cabinet/listings/${listing.id}`;
  const isActive = listing.status === "active";

  // Плашка занятости только у активных: у архивного строк занятости обычно нет,
  // а freeQty без строки возвращает всё количество — вышло бы зелёное
  // «Свободно» на объявлении, которого никто не видит.
  const free = freeQty(listing.quantity, availabilityMap.get(from));
  const busy = free <= 0;
  const partial = free > 0 && free < listing.quantity;
  const dot = busy ? "bg-muted-foreground" : partial ? "bg-accent" : "bg-primary";
  // В отличие от витрины плашка несёт число: владельцу важно, сколько единиц
  // осталось, и больше quantity на этой странице взять негде.
  const freeLabel = busy ? "Занято" : partial ? `Свободно ${free} из ${listing.quantity}` : "Свободно";

  return (
    <article className={`${cardFrame} relative flex flex-col`}>
      <div className="relative">
        {/* 3:2, а не 4:3 как на витрине: здесь снимок опознаёт вещь, а не
          * продаёт её, и лишняя высота в списке своих объявлений мешает. */}
        <div className="relative aspect-[3/2] overflow-hidden bg-muted">
          {photo ? (
            <Image
              src={photo.url}
              alt={listing.title}
              fill
              sizes="(max-width: 640px) 50vw, 300px"
              className="object-cover"
            />
          ) : (
            <span className="flex h-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-8 w-8" aria-hidden="true" />
              <span className="sr-only">Без фото</span>
            </span>
          )}
        </div>

        {/* Обе плашки — одним рядом с justify-between, а не двумя absolute по
          * углам. В две колонки на 360px карточке достаётся ~156px, а «Активно»
          * и «Свободно» вместе с отступами просят ~166px: по углам они молча
          * наехали бы друг на друга. Ряд с min-w-0 и truncate этого не может по
          * построению — при нехватке места ужимается текст, а не соседи. */}
        <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-1 sm:inset-x-2.5 sm:top-2.5">
          {/* «Активно» прячется до sm: на телефоне карточке достаётся ~142px под
            * ряд, а две плашки просят ~156px — и первым многоточие съедало бы
            * число в занятости, ради которого она тут и стоит. Активность и без
            * подписи понятна: рядом висит занятость, которой у скрытых нет.
            * «Скрыто» и «Архив» показываются всегда — вот их пропустить нельзя.
            *
            * Цвет текста не переопределяем: .glass-photo тёмное в обеих темах и
            * задаёт светлый текст, а muted-foreground в светлой теме — тёмно-
            * серый, и на стекле он почти нечитаем. Разницу несёт точка. */}
          <span className={`glass-photo min-w-0 items-center gap-1.5 rounded-sm px-2 py-0.5 text-micro font-medium sm:px-2.5 sm:py-1 sm:text-2xs ${
            isActive ? "hidden sm:inline-flex" : "inline-flex"
          }`}>
            <i
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-primary" : "bg-muted-foreground"}`}
              aria-hidden="true"
            />
            <span className="truncate">{STATUS_LABEL[listing.status]}</span>
          </span>

          {isActive && (
            <span className="glass-photo ml-auto inline-flex min-w-0 items-center gap-1.5 rounded-sm px-2 py-0.5 text-micro font-medium sm:px-2.5 sm:py-1 sm:text-2xs">
              <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
              <span className="truncate">{freeLabel}</span>
            </span>
          )}
        </div>

        {/* Действия поверх растянутой ссылки: без z-10 псевдоэлемент лёг бы на
          * них и кнопки перестали бы нажиматься. */}
        <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1 sm:bottom-2.5 sm:right-2.5 sm:gap-1.5">
          {actions}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-4">
        {/* Подсветка висит на самой ссылке, а не на group от карточки: подвал с
          * кнопками лежит выше по слою, и наведение на него ссылку не трогает —
          * иначе заголовок загорался бы, обещая переход, которого там нет.
          * h3 своего цвета не задаёт и наследует его от ссылки. */}
        <Link
          href={href as never}
          className="block min-w-0 text-foreground transition-colors after:absolute after:inset-0 hover:text-accent"
        >
          <h3 className="truncate text-sm font-semibold leading-snug sm:text-base">
            {listing.title}
          </h3>
        </Link>

        <p className="mt-1 flex items-baseline gap-x-1.5">
          <span className="shrink-0 font-mark text-lg font-bold leading-snug tracking-mark sm:text-xl">
            {price}
          </span>
          <span className="truncate text-xs text-muted-foreground sm:text-sm">в сутки</span>
        </p>
        <p className="truncate text-xs text-muted-foreground sm:text-sm">
          {formatDeposit(listing.depositType, listing.depositAmount)}
        </p>
      </div>

    </article>
  );
}
