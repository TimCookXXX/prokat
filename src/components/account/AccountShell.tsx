"use client";

// Каркас личных зон (кабинет, админка): слева — сайдбар с блоком профиля и
// сгруппированной навигацией, справа — содержимое раздела. На мобайле сайдбар
// не помещается, поэтому разделы едут горизонтальной лентой.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck, Plus, ClipboardList, Bell, Package, CalendarDays, User, LogOut, Settings, Zap,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Brackets } from "@/components/brand/Brackets";
import { Button } from "@/components/ui/button";
import { useSignOut } from "@/components/auth/useSignOut";
import { ruPlural } from "@/lib/plural";
import type { AccountNavGroup, AccountNavIcon } from "@/components/account/accountNav";

const ICONS: Record<AccountNavIcon, typeof User> = {
  summary: Zap,
  requests: ClipboardList,
  inbox: Bell,
  listings: Package,
  calendar: CalendarDays,
  profile: User,
};

export type { AccountNavGroup, AccountNavItem } from "@/components/account/accountNav";

export interface AccountIdentity {
  name: string | null;
  username: string | null;
  image: string | null;
  isVerified: boolean;
  activeListings: number;
  deals: number;
}

function isActive(pathname: string, item: { href: string; exact?: boolean }): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function Badge({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-accent px-1.5 text-2xs font-bold text-accent-foreground">
      {n}
    </span>
  );
}

function IdentityCard({ me, p2p }: { me: AccountIdentity; p2p: boolean }) {
  return (
    <div className="surface flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <Avatar src={me.image} name={me.name} username={me.username} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display font-bold">{me.name ?? "Без имени"}</div>
          {me.username && (
            <div className="truncate text-sm text-muted-foreground">@{me.username}</div>
          )}
        </div>
        <Link
          href={"/profile" as never}
          aria-label="Настройки профиля"
          title="Настройки профиля"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-accent"
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      {/* Рейтинга и отзывов в модели нет — показываем то, что происходит на
       * самом деле: сколько вещей выставлено и сколько аренд состоялось. */}
      {p2p && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>
          {me.activeListings} {ruPlural(me.activeListings, "объявление", "объявления", "объявлений")}
        </span>
        <span>{me.deals} {ruPlural(me.deals, "аренда", "аренды", "аренд")}</span>
      </div>}

      {me.isVerified && (
        <div className="flex items-center gap-2 rounded-md bg-accent/10 px-3 py-2 text-xs text-accent">
          <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          Проверенный продавец
        </div>
      )}
    </div>
  );
}

export function AccountShell({
  groups, identity, p2p = true, children,
}: {
  groups: AccountNavGroup[];
  identity?: AccountIdentity | null;
  /** P2P-контур включён (FEATURE_P2P): статистика вещей и «Разместить вещь». */
  p2p?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const flat = groups.flatMap((g) => g.items);
  // Заголовок — это раздел, в котором стоишь. Отдельное слово «Кабинет» ничего
  // не добавляло: и так видно, где ты, по подсвеченному пункту сайдбара.
  const currentItem = flat.find((it) => isActive(pathname, it));
  const CurrentIcon = currentItem?.icon ? ICONS[currentItem.icon] : null;
  const signOut = useSignOut();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      {/* Мобайл: разделы лентой, группы схлопываются — на узком экране их
        * заголовки съедали бы больше места, чем сами пункты. */}
      <nav
        aria-label="Разделы"
        className="-mx-4 mb-4 flex items-stretch gap-1 overflow-x-auto px-4 md:hidden"
      >
        {flat.map((it) => (
          <Link
            key={it.href}
            href={it.href as never}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-pill px-3 py-2 text-sm ${
              isActive(pathname, it)
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground"
            }`}
          >
            {it.icon && (() => {
              const Icon = ICONS[it.icon];
              return <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />;
            })()}
            {it.label}
            <Badge n={it.badge} />
          </Link>
        ))}

        {identity && (
          <button
            type="button"
            disabled={signOut.pending}
            onClick={signOut.run}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-pill px-3 py-2 text-sm text-muted-foreground disabled:opacity-60"
          >
            <span className="flex w-4 shrink-0 justify-center">
              {signOut.pending
                ? <Brackets size={12} running className="text-current" />
                : <LogOut className="h-4 w-4" aria-hidden="true" />}
            </span>
            {signOut.pending ? "Выходим…" : "Выйти"}
          </button>
        )}
      </nav>

      <div className="md:grid md:grid-cols-[250px_1fr] md:items-start md:gap-5">
        <aside className="hidden md:sticky md:top-20 md:flex md:flex-col md:gap-3.5">
          {identity && <IdentityCard me={identity} p2p={p2p} />}

          <nav aria-label="Разделы" className="surface flex flex-col gap-0.5 p-2">
            {groups.map((group) => (
              <div key={group.title} className="flex flex-col gap-0.5">
                <span className="px-3 pb-1 pt-2.5 font-mono text-2xs uppercase tracking-mono text-muted-foreground">
                  {group.title}
                </span>
                {group.items.map((it) => {
                  const active = isActive(pathname, it);
                  const Icon = it.icon ? ICONS[it.icon] : null;
                  return (
                    <Link
                      key={it.href}
                      href={it.href as never}
                      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                        active
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      }`}
                    >
                      {Icon && (
                        <Icon
                          className={`h-4 w-4 shrink-0 ${active ? "text-accent" : ""}`}
                          aria-hidden="true"
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      <Badge n={it.badge} />
                    </Link>
                  );
                })}
              </div>
            ))}

            {identity && (
              <button
                type="button"
                disabled={signOut.pending}
                onClick={signOut.run}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-60"
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {signOut.pending
                    ? <Brackets size={12} running className="text-current" />
                    : <LogOut className="h-4 w-4" aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {signOut.pending ? "Выходим…" : "Выйти"}
                </span>
              </button>
            )}
          </nav>

          {identity && p2p && (
            <Button asChild className="w-full">
              <Link href={"/cabinet/listings/new" as never}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Разместить вещь
              </Link>
            </Button>
          )}
        </aside>

        <div className="min-w-0">
          {currentItem && (
            <h1 className="mb-4 flex items-center gap-2.5 font-display text-2xl font-bold">
              {CurrentIcon && (
                <CurrentIcon className="h-6 w-6 shrink-0 text-accent" aria-hidden="true" />
              )}
              {currentItem.label}
            </h1>
          )}
          {children}

        </div>
      </div>
    </div>
  );
}
