"use client";

import Link from "next/link";
import { BadgeCheck, ChevronRight, LogOut, Settings, type LucideIcon } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { AvatarViewer } from "@/components/ui/AvatarViewer";
import { AvatarPickerButton } from "@/components/account/AvatarPicker";
import { Brackets } from "@/components/brand/Brackets";
import { ruPlural } from "@/lib/plural";
import type { AccountNavGroup, AccountNavIcon } from "@/components/account/accountNav";
import type { AccountIdentity } from "@/components/account/identity";
import { badgeCount } from "@/lib/badge-count";

/* Мобильный кабинет-хаб: оглавление вместо горизонтальной ленты табов.
 * Профиль сверху (аватар наезжает на обложку), две плитки с итогами, дальше
 * группы разделов строками — как список настроек в телефоне. Тап по строке
 * ведёт на существующий маршрут, назад — кнопкой у заголовка раздела. */
export function CabinetHub({
  me,
  groups,
  icons,
  signOut,
  editable = false,
}: {
  me: AccountIdentity;
  groups: AccountNavGroup[];
  /** Словарь ключ → компонент живёт в AccountShell — сюда приходит готовым. */
  icons: Record<AccountNavIcon, LucideIcon>;
  signOut: { pending: boolean; run: () => void };
  /** Пробрасывается в шапку — см. комментарий у CabinetHubHeader. */
  editable?: boolean;
}) {
  // «Сводка» — это сам хаб: строка «вы находитесь здесь» была бы шумом.
  // Убираем именно её, а не всю группу «сейчас»: рядом в ней живут «Сообщения»,
  // и вместе с группой они пропадали бы из мобильного хаба.
  const sections = groups
    .map((g) => ({ ...g, items: g.items.filter((it) => it.href !== "/cabinet") }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-4 md:hidden">
      <CabinetHubHeader me={me} editable={editable} />

      {sections.map((group, gi) => (
        /* Заголовка может не быть — см. AccountShell: кабинет плоский. */
        <div key={group.title ?? gi} className="flex flex-col gap-2">
          {group.title && (
            <span className="px-1 font-mono text-2xs uppercase tracking-mono text-muted-foreground">
              {group.title}
            </span>
          )}
          <div className="surface flex flex-col p-1">
            {group.items.map((it, i) => {
              const Icon = it.icon ? icons[it.icon] : null;
              const badge = badgeCount(it.badge);
              return (
                <div key={it.href} className="contents">
                  {i > 0 && <span aria-hidden="true" className="mx-3 h-px bg-border" />}
                  <Link
                    href={it.href as never}
                    className="flex min-h-[52px] items-center gap-3 rounded-sm px-3 transition-colors hoverable"
                  >
                    {Icon && <Icon className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />}
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {badge ? (
                      <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-pill bg-accent px-1.5 text-[13px] font-bold text-accent-foreground">
                        <span aria-hidden="true">{badge.display}</span>
                        {/* Голое число рядом с названием раздела вслух звучит
                            как часть названия; при «99+» точный счёт теряется. */}
                        <span className="sr-only">, {badge.label}</span>
                      </span>
                    ) : it.hint ? (
                      <span className="text-sm text-muted-foreground">{it.hint}</span>
                    ) : null}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <button
        type="button"
        disabled={signOut.pending}
        onClick={signOut.run}
        className="surface flex min-h-[52px] items-center gap-3 px-4 text-left text-muted-foreground disabled:opacity-60"
      >
        <span className="flex w-5 shrink-0 justify-center">
          {signOut.pending
            ? <Brackets size={12} running className="text-current" />
            : <LogOut className="h-5 w-5" aria-hidden="true" />}
        </span>
        {signOut.pending ? "Выходим…" : "Выйти"}
      </button>
    </div>
  );
}

/* Верх хаба: профиль с аватаром, свисающим с обложки, и две плитки с итогами.
 * Отдельным компонентом, потому что его рендерит ещё и превью в выборе
 * обложки (CoverPicker) — уменьшенной копией, тем же кодом. */
export function CabinetHubHeader({
  me,
  editable = false,
}: {
  me: AccountIdentity;
  /* Живые аватарка и камера — только на настоящей странице. Этот же блок
   * рендерит уменьшенное превью в выборе обложки: оно aria-hidden и
   * pointer-events-none, и кнопки там были бы мёртвыми контролами. */
  editable?: boolean;
}) {
  return (
    <>
      {/* Визитка: шапка на поверхности, которая наезжает на обложку, — как на
        * десктопе (AccountHero) и на публичном профиле. Плитки с итогами ниже
        * остаются отдельными карточками.
        *
        * relative обязателен: визитка отрицательным margin залезает на обложку,
        * а та позиционирована и без своего контекста рисовалась бы поверх неё.
        *
        * Равнение по верху, а margin аватара подобран так, чтобы его центр
        * совпал со строкой имени: подвесить аватар и при этом центрировать по
        * всему блоку нельзя — он повисает над серединой и читается отдельно
        * от текста. Кольцо цвета КАРТОЧКИ: аватар лежит на визитке и лишь
        * выступающей частью попадает на фотографию.
        *
        * Камера — сосед аватарки, а не вложенная в неё кнопка. */}
      <div className="surface relative -mt-6 flex items-start gap-4 p-4">
        {editable ? (
          <div className="relative -mt-7 shrink-0">
            <AvatarViewer
              src={me.image}
              name={me.name}
              size={72}
              className="shadow-[0_0_0_4px_var(--color-card)]"
            />
            <AvatarPickerButton
              image={me.image}
              name={me.name}
              className="absolute bottom-0 right-0 z-10"
            />
          </div>
        ) : (
          <div className="-mt-7 shrink-0">
            <Avatar
              src={me.image}
              name={me.name}
              size={72}
              className="shadow-[0_0_0_4px_var(--color-card)]"
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-xl font-bold">
            {me.name ?? "Без имени"}
          </div>
          {me.isVerified && (
            <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-accent">
              <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Проверен
            </div>
          )}
          {/* Почта видна только владельцу кабинета — публично её нигде нет.
            * На десктопе она стоит в визитке тем же вторым уровнем. */}
          <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{me.email}</div>
        </div>
        <Link
          href={"/profile" as never}
          aria-label="Настройки профиля"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <Settings className="h-[18px] w-[18px]" aria-hidden="true" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Tile value={me.activeListings} label={ruPlural(me.activeListings, "объявление", "объявления", "объявлений")} />
        <Tile value={me.deals} label={ruPlural(me.deals, "аренда", "аренды", "аренд")} />
      </div>
    </>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="surface px-3.5 py-3">
      <div className="font-mark text-xl font-bold leading-tight">{value}</div>
      <div className="text-[13px] text-muted-foreground">{label}</div>
    </div>
  );
}
