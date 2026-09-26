import Link from "next/link";
import { formatRub, type Quote } from "@/lib/compare/pricing";
import { daysLabel, shortDate } from "@/lib/compare/format";

// Пунктирные блоки под выдачей: кто не участвует в рейтинге и почему.
// Цена на перепроверке — старше 30 дней; только самовывоз — нужна доставка, а не возят.
export function OutOfRanking({
  recheck,
  pickupOnly,
  pickupHref,
}: {
  recheck: Quote[];
  pickupOnly: Quote[];
  pickupHref: string;
}) {
  if (!recheck.length && !pickupOnly.length) return null;
  const box = "flex flex-col gap-1.5 rounded-tabs border border-dashed border-border-strong p-4";
  return (
    <div className="mt-2 grid gap-3 md:grid-cols-2">
      {recheck.length > 0 && (
        <section className={box} aria-label="Цена на перепроверке">
          <h3 className="text-[13px] font-bold text-warn">Цена на перепроверке</h3>
          <ul className="flex flex-col gap-1 text-[15px]">
            {recheck.map((q) => (
              <li key={q.offer.id}>
                <b className="font-semibold">{q.offer.shopName}</b> · {formatRub(q.total)} по данным {shortDate(q.offer.verifiedAt)}
              </li>
            ))}
          </ul>
          <p className="text-[13px] leading-snug text-muted-foreground">
            Не ставим в рейтинг, пока не подтвердим цену звонком.
          </p>
        </section>
      )}
      {pickupOnly.length > 0 && (
        <section className={box} aria-label="Только самовывоз">
          <h3 className="text-[13px] font-bold text-muted-foreground">Только самовывоз</h3>
          <ul className="flex flex-col gap-1 text-[15px]">
            {pickupOnly.map((q) => (
              <li key={q.offer.id}>
                <b className="font-semibold">{q.offer.shopName}</b> · {formatRub(q.total)} за {daysLabel(q.billedDays)}
                {q.offer.district && <span className="text-muted-foreground"> · {q.offer.district}</span>}
              </li>
            ))}
          </ul>
          <p className="text-[13px] leading-snug text-muted-foreground">
            Не возят — отметьте{" "}
            <Link href={pickupHref as never} scroll={false} className="font-semibold text-accent hover:underline">«Заберу сам»</Link>,
            чтобы сравнить.
          </p>
        </section>
      )}
    </div>
  );
}
