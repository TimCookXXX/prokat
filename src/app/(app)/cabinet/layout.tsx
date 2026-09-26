// Каркас кабинета. Доступен любому залогиненному юзеру; owner-табы показываются
// всегда (каждый может разместить товар). Redirect'ов здесь нет — layout
// кэшируется при client-навигации, гейты живут в страницах.

import { requireAuthState } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import { countNewRequests } from "@/server/owner";
import { getCabinetIdentity } from "@/server/me";
import { AccountShell } from "@/components/account/AccountShell";
import { buildAccountNav } from "@/components/account/accountNav";
import { requireP2P } from "@/lib/features";

export default async function CabinetLayout({ children }: { children: React.ReactNode }) {
  requireP2P();
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/cabinet");

  const [newCount, identity] = await Promise.all([
    countNewRequests(session.user.id),
    getCabinetIdentity(session.user.id),
  ]);

  return (
    <AccountShell
      groups={buildAccountNav({ newRequestsCount: newCount })}
      identity={identity}
    >
      {children}
    </AccountShell>
  );
}
