import type { Metadata } from "next";
import { adminLeadSummary } from "@/server/shops";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Обращения — админка", robots: { index: false } };

const TYPES: Record<string, string> = {
  show_phone: "Показали телефон",
  call: "Звонок",
  request: "Заявка",
  regular_request: "«Нужен регулярно»",
  price_outdated: "«Цена устарела?»",
  claim_click: "«Это ваш прокат?»",
};

// Сводка lead_events. Доля кликов на контакт = посетители с show_phone / визиты
// из Метрики (визитов здесь нет — страницы не логируются на сервере).
export default async function AdminLeadsPage() {
  const day = 86_400_000;
  const [week, month] = await Promise.all([
    adminLeadSummary(new Date(Date.now() - 7 * day)),
    adminLeadSummary(new Date(Date.now() - 30 * day)),
  ]);
  const count = (rows: { type: string; n: number; sessions: number }[], t: string) => rows.find((r) => r.type === t);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="types">
        <h2 id="types" className="mb-3 text-lg font-semibold">По типам</h2>
        <table className="w-full max-w-xl text-sm">
          <thead className="text-left text-muted-foreground">
            <tr><th className="py-2 font-medium">Событие</th><th className="py-2 text-right font-medium">7 дней</th><th className="py-2 text-right font-medium">30 дней</th><th className="py-2 text-right font-medium">посетителей, 30 дн.</th></tr>
          </thead>
          <tbody>
            {Object.entries(TYPES).map(([t, label]) => (
              <tr key={t} className="border-t border-border">
                <td className="py-2">{label}</td>
                <td className="py-2 text-right tabular-nums">{count(week.byType, t)?.n ?? 0}</td>
                <td className="py-2 text-right tabular-nums">{count(month.byType, t)?.n ?? 0}</td>
                <td className="py-2 text-right tabular-nums">{count(month.byType, t)?.sessions ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">Доля кликов на контакт: посетители с «Показали телефон» ÷ визиты страниц сравнения в Метрике.</p>
      </section>

      <section aria-labelledby="classes">
        <h2 id="classes" className="mb-3 text-lg font-semibold">Показы телефона по классам, 30 дней</h2>
        {month.byClass.length === 0 ? <p className="text-sm text-muted-foreground">Пока нет.</p> : (
          <ul className="flex max-w-xl flex-col gap-1 text-sm">
            {month.byClass.map((r) => (
              <li key={r.cls} className="flex justify-between border-t border-border py-2"><span>{r.cls}</span><span className="tabular-nums">{r.n}</span></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
