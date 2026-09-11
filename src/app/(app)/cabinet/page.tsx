import { redirect } from "next/navigation";
import { requireAuthState } from "@/lib/auth/guard";
import { getCabinetSummary } from "@/server/cabinet";
import { todayStr } from "@/lib/catalog/dates";
import { Stats } from "@/components/cabinet/StatTile";
import { SummaryPanel } from "@/components/cabinet/SummaryPanel";
import { CountersSync } from "@/components/realtime/CountersSync";
import { ScrollReset } from "@/components/account/ScrollReset";
import {
  markRequestNotificationsSeen, purgeReadNotifications,
} from "@/server/notifications";

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

  /* Гасим события по заявкам обеих сторон: решения теперь принимаются здесь, и
   * кружок, продолжающий гореть над разобранной панелью, врал бы. Обе стороны
   * безусловно — в отличие от ленты, где фильтр по роли может показать только
   * половину: панель показывает всё живое сразу. */
  await markRequestNotificationsSeen(session.user.id, "owner");
  await markRequestNotificationsSeen(session.user.id, "customer");
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

      {/* Сегодняшний день считает сервер и передаёт строкой: на полуночной
        * границе он у сервера и у браузера разный, а панель попадает в SSR. */}
      <SummaryPanel rows={rows} rest={rest} today={todayStr()} />
    </div>
  );
}
