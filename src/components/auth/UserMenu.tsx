"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Package, ClipboardList, CalendarDays, Settings, ShieldCheck, LogOut, Palette, Store } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Brackets } from "@/components/brand/Brackets";
import { Avatar } from "@/components/ui/Avatar";
import { ThemeSegmented } from "@/components/providers/ThemeSegmented";
import { content } from "@theme/content";

type Props = {
  username: string;
  name: string | null;
  image: string | null;
  isAdmin?: boolean;
  /** P2P-контур включён (FEATURE_P2P): ссылки на вещи, заявки, календарь. */
  p2p?: boolean;
  /** Владелец подтверждённого проката — ссылка в кабинет проката. */
  shopOwner?: boolean;
};

// Курсор успевает пройти зазор между аватаром и меню — закрываем с задержкой.
const CLOSE_DELAY_MS = 160;

// Иконки нейтральные: скобки остаются пиктограммой только в таб-баре, чтобы
// бренд не спорил с навигацией.
const P2P_LINKS = [
  { href: "/cabinet/listings", label: "Мои товары", Icon: Package },
  { href: "/requests", label: "Мои заявки", Icon: ClipboardList },
  { href: "/cabinet/calendar", label: "Календарь", Icon: CalendarDays },
] as const;
const SETTINGS_LINK = { href: "/profile", label: "Настройки", Icon: Settings } as const;
const SHOP_LINK = { href: "/moy-prokat", label: "Мой прокат", Icon: Store } as const;

export function UserMenu({ username, name, image, isAdmin = false, p2p = true, shopOwner = false }: Props) {
  const links = [...(shopOwner ? [SHOP_LINK] : []), ...(p2p ? P2P_LINKS : []), SETTINGS_LINK];
  // Без P2P кабинета нет — аватар ведёт в профиль.
  const homeHref = p2p ? "/cabinet" : "/profile";

  // signOut делает XHR + redirect, без feedback'а пункт меню «зависает».
  // useTransition держит pending до окончания навигации.
  const [isSigningOut, startSignOut] = useTransition();

  // Меню раскрывается наведением, а сам аватар — ссылка в кабинет. Поэтому
  // состояние ведём вручную: штатный триггер Radix открывался бы по клику и
  // перехватывал переход.
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openNow = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  return (
    // modal=false: dropdown не должен включать react-remove-scroll. Иначе Radix
    // добавляет padding-right на <body> для компенсации скроллбара, и хедер
    // прыгает (вдвойне — с нашим scrollbar-gutter: stable место уже занято).
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Link
          href={homeHref as never}
          aria-label={p2p ? "Кабинет" : "Профиль"}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-ring"
          onMouseEnter={openNow}
          onMouseLeave={closeSoon}
          // Radix открывает меню по pointerdown — гасим, иначе клик по аватару
          // раскрывал бы список вместо перехода в кабинет.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => setOpen(false)}
        >
          <Avatar src={image} name={name} username={username} size={36} />
        </Link>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="min-w-[220px]"
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        // Radix при закрытии возвращает фокус на триггер. Для меню по наведению
        // это лишнее: фокус на аватаре снова открывал бы список, а курсора там
        // уже нет — и закрыть его было бы нечем.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem asChild className="gap-2.5 px-2 py-2">
          <Link href={homeHref as never}>
            <Avatar src={image} name={name} username={username} size={32} />
            <span className="min-w-0">
              <span className="block truncate font-medium">{name ?? `@${username}`}</span>
              {name && <span className="block truncate text-xs text-muted-foreground">@{username}</span>}
            </span>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {links.map(({ href, label, Icon }) => (
          <DropdownMenuItem key={href} asChild className="gap-2.5">
            <Link href={href as never}>
              <span className="flex w-6 shrink-0 justify-center">
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </span>
              {label}
            </Link>
          </DropdownMenuItem>
        ))}

        {isAdmin && (
          <DropdownMenuItem asChild className="gap-2.5">
            <Link href={"/admin" as never}>
              <span className="flex w-6 shrink-0 justify-center">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </span>
              Админка
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <div className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
          <span className="flex items-center gap-2.5">
            <span className="flex w-6 shrink-0 justify-center">
              <Palette className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </span>
            Тема
          </span>
          <ThemeSegmented />
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="gap-2.5"
          disabled={isSigningOut}
          onSelect={(e) => {
            // preventDefault — иначе Radix закроет меню сразу, вместе с лоадером.
            // Колбэк асинхронный: React 19 держит pending до конца await, тогда
            // как синхронный вызов снимал его в тот же кадр.
            e.preventDefault();
            startSignOut(async () => { await signOut({ callbackUrl: "/" }); });
          }}
        >
          <span className="flex w-6 shrink-0 justify-center">
            {isSigningOut ? (
              <Brackets size={12} running className="text-current" />
            ) : (
              <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            )}
          </span>
          {isSigningOut ? "Выходим…" : content.auth.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
