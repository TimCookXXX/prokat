"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LoginTrigger } from "@/components/auth/LoginTrigger";
import { Search, ClipboardList, Package, Plus, User } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/utils";

/* Мобильная навигация: парящая пилюля внизу экрана — зеркалит стеклянные
 * пилюли шапки. Пять пунктов, как в брендбуке, но «Чаты» заменены на
 * «Заявки»: переписки в продукте ещё нет, а заявки — центральный флоу.
 * Иконки нейтральные, чтобы бренд не спорил с навигацией. */
export function TabBar({
  placeHref,
  user,
  authProps,
}: {
  placeHref: string;
  user: { name: string | null; username: string | null; image: string | null } | null;
  // Флаги входа: анониму «Сдать» открывает модалку, а не уводит на /login —
  // так же, как кнопка в десктопном хедере.
  authProps: { nextAuthProviders: string[]; vkEnabled: boolean; canRegisterByEmail: boolean };
}) {
  const pathname = usePathname();
  const isOn = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const itemClass = (on: boolean) =>
    cn(
      "flex min-h-[44px] min-w-12 flex-col items-center justify-center gap-1 text-xs leading-none",
      on ? "text-primary" : "text-muted-foreground",
    );

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
  const requests = isOn("/requests");
  const profile = isOn("/profile");

  return (
    <nav
      aria-label="Основная навигация"
      data-tabbar
      className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
    >
      <div className="glass mx-auto flex max-w-[420px] items-center justify-between gap-2 rounded-[22px] px-4 py-1.5">
        <Link href={"/search" as never} className={itemClass(isOn("/search"))}>
          <Search className="h-[22px] w-[22px]" aria-hidden="true" />
          Поиск
        </Link>

        {tab("/cabinet/listings", itemClass(myItems), (
          <>
            <Package className="h-[22px] w-[22px]" aria-hidden="true" />
            Мои вещи
          </>
        ))}

        {tab(placeHref, "flex min-h-[44px] min-w-12 flex-col items-center justify-center gap-1 text-xs leading-none text-muted-foreground", (
          <>
            {/* Круг держим вровень со строкой иконок, иначе колонка «Сдать»
             * оказывается выше остальных и тянет за собой всю панель. */}
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Plus className="h-4 w-4" aria-hidden="true" />
            </span>
            Сдать
          </>
        ))}

        {tab("/requests", itemClass(requests), (
          <>
            <ClipboardList className="h-[22px] w-[22px]" aria-hidden="true" />
            Заявки
          </>
        ))}

        {tab("/profile", itemClass(profile), (
          <>
            {user ? (
              <Avatar src={user.image} name={user.name} username={user.username} size={22} />
            ) : (
              <User className="h-[22px] w-[22px]" aria-hidden="true" />
            )}
            Профиль
          </>
        ))}
      </div>
    </nav>
  );
}
