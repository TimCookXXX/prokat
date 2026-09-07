// Собеседник в шапке переписки: аватар и имя одним таргетом, ведут в профиль.
//
// Общий для открытой переписки и экрана новой переписки — это одна и та же
// шапка, и вторая её реализация разъезжается с первой на первой же правке.
// subtitle нужен только новой переписке: там под именем стоит название вещи,
// в открытой переписке её показывает чип.

import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";

// min-w-0 обязателен обеим веткам: без него truncate у имени не работает и
// длинное имя выдавливает соседей из шапки. Отрицательное поле компенсирует
// внутреннее, чтобы аватар стоял на том же месте, что и без ссылки.
const BOX = "-mx-1.5 flex min-w-0 items-center gap-3 rounded-sm px-1.5 py-1";

export function ChatPersonLink({
  userId, name, image, banned = false, subtitle,
}: {
  userId: string;
  name: string;
  image: string | null;
  /** Профиль забаненного отдаёт 404 — имя остаётся, ссылка нет. */
  banned?: boolean;
  subtitle?: string;
}) {
  const inner = (
    <>
      <Avatar src={image} name={name} size={40} />
      <div className="min-w-0">
        <h2 className="truncate font-display text-base font-bold leading-tight md:text-lg">
          {name}
        </h2>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </>
  );

  // flex-1 держит обёртка, а не сама ссылка: иначе подсветка ховера
  // растянулась бы через всю пустую середину шапки до чипа объявления.
  return (
    <div className="flex min-w-0 flex-1">
      {banned ? (
        <div className={BOX}>{inner}</div>
      ) : (
        <Link
          href={`/u/${userId}` as never}
          className={`${BOX} hoverable focus-visible:[outline:none] focus-visible:ring-2 focus-visible:ring-ring`}
        >
          {inner}
        </Link>
      )}
    </div>
  );
}
