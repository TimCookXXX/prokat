// Личная зона кабинета (заявки, профиль). Единая навигация: owner-табы
// показываются всем залогиненным юзерам.

import { redirect } from "next/navigation";
import { requireAuthState } from "@/lib/auth/guard";
import { countNewRequests } from "@/server/owner";
import { getCabinetIdentity } from "@/server/me";
import { AccountShell } from "@/components/account/AccountShell";
import { buildAccountNav } from "@/components/account/accountNav";
import { isP2PEnabled } from "@/lib/features";

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/profile");

  const p2p = isP2PEnabled();
  const [newCount, identity] = await Promise.all([
    p2p ? countNewRequests(session.user.id) : 0,
    getCabinetIdentity(session.user.id),
  ]);

  return (
    <AccountShell
      groups={buildAccountNav({ newRequestsCount: newCount, p2p })}
      identity={identity}
      p2p={p2p}
    >
      {children}
    </AccountShell>
  );
}
