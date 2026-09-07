// Единый источник навигации кабинета.
//
// По роли разделы больше НЕ делятся. Человек в C2C сдаёт и арендует
// одновременно, и деление «я арендую» / «мои вещи» заставляло его сначала
// вспомнить, кто он в этой сделке, и только потом понять, куда идти. Заявки
// обеих ролей живут одной лентой, роль внутри неё — фильтр.

// Иконка передаётся ключом, а не компонентом: навигацию собирает серверный
// layout, а функции через границу RSC не сериализуются. Словарь ключ → иконка
// живёт в AccountShell, на клиенте.
export type AccountNavIcon =
  | "summary" | "messages" | "inbox"
  | "listings" | "profile";

export interface AccountNavItem {
  href: string;
  label: string;
  badge?: number;
  /** Спокойная подпись справа в мобильном хабе («3», «2 брони»). Бейдж — про
   *  то, что ждёт ответа; hint — про то, что просто есть. */
  hint?: string;
  icon?: AccountNavIcon;
  /** Совпадение только точное. Нужно там, где адрес — префикс соседних
   *  разделов: /cabinet иначе подсвечивался бы на всех страницах кабинета. */
  exact?: boolean;
}

export interface AccountNavGroup {
  /** Без заголовка — плоский список. Кабинет теперь такой: пять пунктов не
   *  нуждаются в оглавлении, а заголовки, что у него были, называли роли. */
  title?: string;
  items: AccountNavItem[];
}

export interface AccountNavCounts {
  newRequestsCount: number;
  /** Непрочитанные сообщения по всем переписками, обе роли сразу. */
  unreadMessages?: number;
  /** Ниже — только для подписей мобильного хаба; в сайдбаре их не видно. */
  activeListings?: number;
}

export function buildAccountNav(
  {
    newRequestsCount, unreadMessages,
    activeListings,
  }: AccountNavCounts,
): AccountNavGroup[] {
  // Один список без заголовков. Группировать нечем и незачем: заголовки
  // называли роли («я арендую», «мои вещи»), а роль перестала быть способом
  // навигации — заявки обеих сторон живут одной лентой, занятость уехала внутрь
  // вещи. Пяти пунктам оглавление не нужно.
  return [
    {
      items: [
        { href: "/cabinet", label: "Сводка", icon: "summary", exact: true },
        // Бейдж — только про ожидающие МОЕГО ответа: это число уезжает ещё и в
        // герой кабинета как «ждут ответа». Чужие решения по моим заявкам сюда
        // не складываются, иначе подпись начнёт врать.
        { href: "/cabinet/requests", label: "Заявки", badge: newRequestsCount, icon: "inbox" },
        { href: "/chat", label: "Сообщения", badge: unreadMessages, icon: "messages" },
        {
          href: "/cabinet/listings",
          label: "Мои объявления",
          hint: activeListings ? String(activeListings) : undefined,
          icon: "listings",
        },
        { href: "/profile", label: "Профиль", icon: "profile" },
      ],
    },
  ];
}

