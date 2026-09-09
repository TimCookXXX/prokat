// /chat — на десктопе заглушка правой колонки, на мобиле не видна вовсе
// (там показан список). Вход в новую переписку — /chat/new/[listingId],
// со страницы объявления; отдельного входа отсюда нет: тред привязан
// к объявлению.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAuthState } from "@/lib/auth/guard";
import { countThreads } from "@/server/chat";
import { content } from "@theme/content";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Сообщения",
  robots: { index: false },
};

export default async function ChatPage() {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/chat");

  // Без переписок вовсе заглушка занимает всю ширину (список слева не
  // рисуется). С переписками она нужна только на десктопе: на мобиле в этом
  // месте показан список.
  const total = await countThreads(session.user.id);
  // Карточку рисует ChatPanes — вторая .surface дала бы двойной кант внутри
  // одной панели. h-full min-h-0 нужен из-за min-h-[45svh] у EmptyState:
  // это процент от вьюпорта, а не от колонки.
  return (
    <div className={`h-full min-h-0 ${total === 0 ? "" : "hidden md:block"}`}>
      <EmptyState className="h-full">
        {total === 0 ? content.chat.emptyThreads : content.chat.emptyPick}
      </EmptyState>
    </div>
  );
}
