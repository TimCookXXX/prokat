// Единый источник навигации кабинета. Разделы сгруппированы по роли, в которой
// человек сейчас находится: «я арендую» и «мои вещи». Отдельной сущности
// «владелец» нет — обе группы доступны любому залогиненному юзеру.

// Иконка передаётся ключом, а не компонентом: навигацию собирает серверный
// layout, а функции через границу RSC не сериализуются. Словарь ключ → иконка
// живёт в AccountShell, на клиенте.
export type AccountNavIcon = "summary" | "requests" | "inbox" | "listings" | "calendar" | "profile";

export interface AccountNavItem {
  href: string;
  label: string;
  badge?: number;
  icon?: AccountNavIcon;
  /** Совпадение только точное. Нужно там, где адрес — префикс соседних
   *  разделов: /cabinet иначе подсвечивался бы на всех страницах кабинета. */
  exact?: boolean;
}

export interface AccountNavGroup {
  title: string;
  items: AccountNavItem[];
}

export function buildAccountNav(
  { newRequestsCount, p2p = true }: { newRequestsCount: number; p2p?: boolean },
): AccountNavGroup[] {
  const account: AccountNavGroup = {
    title: "аккаунт",
    items: [{ href: "/profile", label: "Профиль", icon: "profile" }],
  };
  // Без P2P-контура (FEATURE_P2P) вещей и заявок нет — остаётся только аккаунт.
  if (!p2p) return [account];
  return [
    {
      title: "сейчас",
      items: [{ href: "/cabinet", label: "Сводка", icon: "summary", exact: true }],
    },
    {
      title: "мои вещи",
      items: [
        { href: "/cabinet/requests", label: "Заявки на мои вещи", badge: newRequestsCount, icon: "inbox" },
        { href: "/cabinet/listings", label: "Мои объявления", icon: "listings" },
        { href: "/cabinet/calendar", label: "Календарь занятости", icon: "calendar" },
      ],
    },
    {
      title: "я арендую",
      items: [{ href: "/requests", label: "Мои заявки", icon: "requests" }],
    },
    account,
  ];
}
