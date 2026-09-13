import Link from "next/link";
import { BadgeCheck, Plus, Settings } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { AvatarViewer } from "@/components/ui/AvatarViewer";
import { AvatarPickerButton } from "@/components/account/AvatarPicker";
import { Button } from "@/components/ui/button";
import { Metric } from "@/components/ui/Metric";
import { ruPlural } from "@/lib/plural";
import type { AccountIdentity } from "@/components/account/identity";

/* Визитка профиля под обложкой на десктопе: поверхность наезжает на фото,
 * аватар свисает с её верхней кромки, рядом имя, статус, три числа и действия.
 * Та же карточка, что у публичного профиля продавца (app/(public)/u/[id]) —
 * личная зона и витрина открываются одинаково.
 *
 * Рейтинга в модели нет, поэтому метрики — то, что происходит на самом деле:
 * сколько вещей выставлено, сколько аренд состоялось и сколько заявок ждёт
 * ответа прямо сейчас.
 *
 * Мобильной версии здесь нет: на телефоне тот же профиль рисует CabinetHub. */
export function AccountHero({
  me,
  pendingCount,
  editable = false,
}: {
  me: AccountIdentity;
  pendingCount: number;
  /* Живые аватарка и камера — только на настоящей странице. Этого же героя
   * рендерит уменьшенное превью в выборе обложки: оно aria-hidden и
   * pointer-events-none, и кнопки там были бы мёртвыми контролами. */
  editable?: boolean;
}) {
  return (
    /* relative обязателен: визитка отрицательным margin залезает на обложку,
     * а та позиционирована и без своего контекста рисовалась бы поверх неё. */
    <div className="surface relative -mt-14 hidden items-center gap-5 p-4 md:flex">
      {/* Аватар остаётся элементом строки, а выступает за верхнюю кромку
        * отрицательным margin: при items-center центрируется его сжатый
        * margin-box, поэтому он и свисает, и держится почти на одной линии с
        * именем. Тот же приём, что в визитке публичного профиля.
        *
        * Кольцо цвета КАРТОЧКИ, а не холста: аватар лежит на визитке и лишь
        * выступающей частью попадает на фотографию.
        *
        * Кнопка-камера — сосед аватарки, а не вложенная в неё: кнопка внутри
        * кнопки это невалидная разметка и предупреждение гидратации. */}
      {editable ? (
        <div className="relative -mt-12 shrink-0">
          <AvatarViewer
            src={me.image}
            name={me.name}
            size={96}
            className="shadow-[0_0_0_4px_var(--color-card)]"
          />
          <AvatarPickerButton
            image={me.image}
            name={me.name}
            className="absolute bottom-0 right-0 z-10"
          />
        </div>
      ) : (
        <div className="-mt-12 shrink-0">
          <Avatar
            src={me.image}
            name={me.name}
            size={96}
            className="shadow-[0_0_0_4px_var(--color-card)]"
          />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* text-2xl вместо прежних 26px произвольным значением: ступень шкалы,
            * и с leading-tight имя перестаёт задавать высоту всей визитки —
            * у Manrope нормальный интерлиньяж на этом кегле добавлял ей 15px. */}
          <span className="truncate font-display text-2xl font-extrabold leading-tight tracking-tight">
            {me.name ?? "Без имени"}
          </span>
          {me.isVerified && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-accent/15 px-2.5 py-0.5 text-sm font-medium text-accent">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Проверен
            </span>
          )}
        </div>
        {/* Почта видна только владельцу кабинета — публично её нигде нет. */}
        <div className="mt-0.5 truncate text-sm text-muted-foreground">{me.email}</div>
      </div>

      {/* С lg, а не с md: в строке четыре группы, и вместе они требуют около
        * 1016px ширины окна. На 768–1023 первым схлопывалось имя — до «D..»,
        * — поэтому на этой полосе числа уступают место имени и действиям.
        * «Ждут ответа» там остаётся бейджем на «Заявках» в сайдбаре. */}
      <div className="hidden shrink-0 items-center gap-8 lg:flex">
        <Metric value={me.activeListings} label={ruPlural(me.activeListings, "объявление", "объявления", "объявлений")} />
        <Metric value={me.deals} label={ruPlural(me.deals, "аренда", "аренды", "аренд")} />
        <Metric value={pendingCount} label={ruPlural(pendingCount, "ждёт ответа", "ждут ответа", "ждут ответа")} accent />
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        <Button asChild>
          <Link href={"/cabinet/listings/new" as never}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Разместить вещь
          </Link>
        </Button>
        <Link
          href={"/profile" as never}
          aria-label="Настройки профиля"
          title="Настройки профиля"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-accent"
        >
          <Settings className="h-[18px] w-[18px]" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
