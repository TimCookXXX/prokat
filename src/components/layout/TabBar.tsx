"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LoginTrigger } from "@/components/auth/LoginTrigger";
import { LayoutGrid, MessageCircle, Plus, User } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/utils";
import { LiveDot } from "@/components/realtime/LiveDot";
import { useCurrentCity } from "./use-current-city";

/* Мобильная навигация: парящая пилюля внизу экрана — зеркалит стеклянные
 * пилюли шапки. Пять пунктов, как в брендбуке, но на месте «Чатов» — «Заявки»:
 * заявки остаются центральным флоу, а переписка живёт разделом кабинета
 * (/chat) и достижима оттуда и из мобильного хаба. Пятое место — продуктовое
 * решение, менять его вместе с появлением чата не стали.
 *
 * Скобки работают пиктограммой только здесь («Объявления») — в остальных местах
 * это знак. Прочие иконки нейтральные, чтобы бренд не спорил с навигацией. */
export function TabBar({
  placeHref,
  cities,
  user,
  authProps,
}: {
  placeHref: string;
  // Слаги активных городов: по ним вкладка «Каталог» узнаёт город текущего
  // адреса, а где его нет — берёт выбранный. Ведёт она на витрину города
  // (/kazan), а не на /search: выдача у них одинаковая, но витрина —
  // индексируемая страница города, а поиск закрыт от индексации и живёт в шапке.
  cities: readonly string[];
  user: { name: string | null; image: string | null } | null;
  // Флаги входа: анониму «Сдать» открывает модалку, а не уводит на /login —
  // так же, как кнопка в десктопном хедере.
  authProps: { nextAuthProviders: string[]; vkEnabled: boolean; canRegisterByEmail: boolean };
}) {
  const pathname = usePathname();
  const isOn = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const { slug: citySlug } = useCurrentCity(cities);
  const catalogHref = citySlug ? `/${citySlug}` : "/";

  const itemClass = (on: boolean) =>
    cn(
      "flex min-h-[44px] min-w-12 flex-col items-center justify-center gap-1 text-xs leading-none",
      on ? "text-primary" : "text-muted-foreground",
    );

  // На самых узких экранах подпись на ступень мельче: «Объявления» вдвое длиннее
  // соседних, и в полном кегле пять колонок на 320 px не помещаются. Обрезка —
  // страховка на случай, если и этого не хватит: вылезшая подпись наезжает на
  // соседнюю, обрезанная — нет. leading-snug при этом обязателен: с leading-none
  // overflow срезал бы хвосты у «д» и «у».
  const labelClass = "w-full truncate text-center text-2xs leading-snug min-[375px]:text-xs";

  // Аноним ни в один закрытый раздел не попадёт — middleware выбросит его на
  // /login. Поэтому вместо ссылки даём вход модалкой, а после входа ведём туда,
  // куда он жал.
  const tab = (href: string, className: string, children: React.ReactNode) =>
    user ? (
      <Link href={href as never} className={className}>{children}</Link>
    ) : (
      <LoginTrigger {...authProps} redirectTo={href} className={className}>{children}</LoginTrigger>
    );

  const myItems = isOn("/cabinet/listings");
  const messages = isOn("/chat");
  // Весь кабинет, кроме «Объявлений» (у них своя вкладка), плюс профиль:
  // он живёт на отдельном /profile, но открывается из кабинета и часть его.
  const cabinet = (isOn("/cabinet") && !myItems) || isOn("/profile");

  return (
    <nav
      aria-label="Основная навигация"
      data-tabbar
      className="fixed inset-x-0 bottom-0 z-40 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] min-[375px]:px-4 md:hidden"
    >
      {/* Поля и зазоры ужаты на самых узких экранах: подпись «Объявления» вдвое
        * длиннее остальных, и на 320 px пять колонок в прежние отступы не
        * помещались — подписи наезжали друг на друга. */}
      <div className="glass mx-auto flex max-w-[420px] items-center justify-between gap-1 rounded-lg px-2 py-1.5 min-[375px]:gap-2 min-[375px]:px-4">
        <Link
          href={catalogHref as never}
          className={itemClass(catalogHref !== "/" && isOn(catalogHref))}
        >
          <LayoutGrid className="h-[22px] w-[22px]" aria-hidden="true" />
          <span className={labelClass}>Каталог</span>
        </Link>

        {tab("/cabinet/listings", itemClass(myItems), (
          <>
            <span className="flex h-[22px] items-center">
              <Logo
                size={20}
                showWord={false}
                bracketClassName={myItems ? "border-accent" : "border-muted-foreground"}
              />
            </span>
            <span className={labelClass}>Объявления</span>
          </>
        ))}

        {tab(placeHref, "flex min-h-[44px] min-w-12 flex-col items-center justify-center gap-1 text-xs leading-none text-muted-foreground", (
          <>
            {/* Круг держим вровень со строкой иконок, иначе колонка «Сдать»
             * оказывается выше остальных и тянет за собой всю панель. */}
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Plus className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className={labelClass}>Сдать</span>
          </>
        ))}

        {tab("/chat", itemClass(messages), (
          <>
            <span className="relative inline-flex h-[22px] items-center">
              <MessageCircle className="h-[22px] w-[22px]" aria-hidden="true" />
              <LiveDot scope="messages" />
            </span>
            <span className={labelClass}>Чаты</span>
          </>
        ))}

        {/* Ведёт в сводку кабинета, а не в настройки профиля: человеку нужны
          * его заявки и вещи, а редактирование имени — редкий случай, он
          * доступен из кабинета. */}
        {tab("/cabinet", itemClass(cabinet), (
          <>
            <span className="relative inline-flex">
              {user ? (
                <Avatar src={user.image} name={user.name} size={22} />
              ) : (
                <User className="h-[22px] w-[22px]" aria-hidden="true" />
              )}
              {/* Только НЕ-чаты: сообщения уже отмечены на соседней вкладке,
                  и второй такой же кружок был бы дублем. */}
              <LiveDot scope="other" />
            </span>
            <span className={labelClass}>Кабинет</span>
          </>
        ))}
      </div>
    </nav>
  );
}
