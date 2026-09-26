// Админка. Доступ — только role=admin (assertAdmin редиректит остальных).

import { assertAdmin } from "@/lib/auth/assert-admin";
import { AccountShell } from "@/components/account/AccountShell";
import { isP2PEnabled } from "@/lib/features";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await assertAdmin();
  const p2p = isP2PEnabled();

  return (
    <AccountShell
      groups={[
        {
          title: "сравнение",
          items: [
            { href: "/admin/shops", label: "Прокаты" },
            { href: "/admin/regular", label: "Нужен регулярно" },
            { href: "/admin/leads", label: "Обращения" },
          ],
        },
        {
          title: "модерация",
          items: [
            ...(p2p ? [
              { href: "/admin/listings", label: "Объявления" },
              { href: "/admin/requests", label: "Заявки" },
            ] : []),
            { href: "/admin/users", label: "Пользователи" },
          ],
        },
        {
          title: "справочники",
          items: [
            { href: "/admin/cities", label: "Города" },
            { href: "/admin/categories", label: "Категории" },
          ],
        },
      ]}
    >
      {children}
    </AccountShell>
  );
}
