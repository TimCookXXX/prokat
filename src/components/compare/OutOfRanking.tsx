import { formatRub, type Quote } from "@/lib/compare/pricing";
import { shortDate } from "@/lib/compare/format";

// «Цена на перепроверке» (ТЗ, п. 5.5): проверена больше 30 дней назад — в рейтинге
// и вкладках не участвует, показываем отдельно.
export function OutOfRanking({ recheck }: { recheck: Quote[] }) {
  if (!recheck.length) return null;
  return (
    <section
      aria-label="Цена на перепроверке"
      className="mt-2 flex flex-col gap-1.5 rounded-tabs border border-dashed border-border-strong p-4"
    >
      <h3 className="text-[13px] font-bold text-warn">Цена на перепроверке</h3>
      <ul className="flex flex-col gap-1 text-[15px]">
        {recheck.map((q) => (
          <li key={q.offer.id}>
            <b className="font-semibold">{q.offer.shopName}</b> · {formatRub(q.total)} по данным {shortDate(q.offer.verifiedAt)}
          </li>
        ))}
      </ul>
      <p className="text-[13px] leading-snug text-muted-foreground">Не ставим в рейтинг, пока не подтвердим цену.</p>
    </section>
  );
}
