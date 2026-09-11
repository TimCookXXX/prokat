import { redirect } from "next/navigation";
import { requireAuthState } from "@/lib/auth/guard";
import { getCabinetSummary } from "@/server/cabinet";
import { Stats } from "@/components/cabinet/StatTile";
import { SummaryPanel } from "@/components/cabinet/SummaryPanel";
import { CountersSync } from "@/components/realtime/CountersSync";
import { ScrollReset } from "@/components/account/ScrollReset";
import { markRequestsSeen, purgeReadNotifications } from "@/server/notifications";

export const dynamic = "force-dynamic";

// Кабинет открывается сводкой, а не списком: пять разделов вручную обходить
// никто не станет, а срок горит только у входящих заявок.
//
// Сводка — одна панель, а не три раздела по ролям: человек в C2C сдаёт и
// арендует одновременно, и роль стала подписью в строке (ADR 0020).
export default async function CabinetIndex() {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/cabinet");

  const { rows, rest, stats } = await getCabinetSummary(session.user.id);

  /* Гасим ровно те заявки, что человек увидел, — по их идентификаторам, а не
   * по стороне. Гашение по стороне здесь было бы обманом: панель держит только
   * живое и только первые восемь строк, а отказ, отмена и завершение рождаются
   * в момент, когда заявка СТАЛА закрытой, и в панель не попадают никогда. Под
   * нож ушло бы именно то, о чём человеку и хотели сказать.
   *
   * Лента гасит по стороне по обратной причине: она показывает все статусы, и
   * сузить её может только фильтр роли. */
  await markRequestsSeen(session.user.id, rows.map((r) => r.id));
  await purgeReadNotifications();

  return (
    <div className="flex flex-col gap-8">
      <ScrollReset />
      <CountersSync />
      <Stats
        items={[
          { value: stats.views7d, label: "просмотров за неделю" },
          { value: stats.requests30d, label: "заявок за месяц" },
          { value: stats.activeListings, label: "активных объявлений" },
          { value: stats.busyDays30d, label: "дней занято впереди", accent: true },
        ]}
      />

      <SummaryPanel rows={rows} rest={rest} />
    </div>
  );
}
