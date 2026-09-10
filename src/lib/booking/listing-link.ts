// Куда вести с заявки — из ленты, из сводки, откуда угодно.
//
// Заявка живёт дольше объявления: вещь скрыли или убрали в архив, а история
// сделки осталась. Владелец может убрать вещь и посреди идущей аренды —
// setListingStatus активных броней не смотрит. Ссылка на публичную страницу в
// таком случае вела бы в 404.
//
// Видимость спрашиваем у catalog/visibility — там она объявлена единственным
// правилом публичного контура, и статусом она не исчерпывается: бан владельца
// закрывает страницу даже у объявления, которое админ поднял обратно в active.
//
// Владельцу есть куда пойти при любом статусе — на его страницу вещи в
// кабинете. Арендатору идти некуда: публичной страницы нет, кабинет чужой.
// null здесь значит «названию остаться текстом», а не «ошибка».

import { isPubliclyVisible, type ListingVisibility } from "@/lib/catalog/visibility";
import { listingPath } from "@/lib/catalog/listing-path";
import type { RequestSide } from "@/lib/booking/request-access";

export type LinkableListing = ListingVisibility & {
  id: string;
  slug: string;
  citySlug: string;
  categorySlug: string;
};

export function requestListingHref(
  listing: LinkableListing,
  side: RequestSide,
): string | null {
  if (isPubliclyVisible(listing)) {
    return listingPath(listing.citySlug, listing.categorySlug, listing.slug, listing.id);
  }
  return side === "owner" ? `/cabinet/listings/${listing.id}` : null;
}
