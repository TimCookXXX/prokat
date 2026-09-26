import Link from "next/link";
import { CircleDollarSign } from "lucide-react";
import { formatRub, type SavingsHint as Hint } from "@/lib/compare/pricing";

// «Нужен на неделю?» — когда недельный тариф выгоднее суточной цены × 7
// больше чем на 10% (pricing.weekSavingsHint).
export function SavingsHint({ hint, weekHref }: { hint: Hint; weekHref: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-field bg-cta-soft px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-3">
      <CircleDollarSign className="hidden h-5 w-5 shrink-0 text-cta sm:block" aria-hidden="true" />
      <p className="flex-1">
        Нужен на неделю? У «{hint.offer.shopName}» недельный тариф —{" "}
        <b className="font-bold">{formatRub(hint.weekPrice)}</b> вместо {formatRub(hint.dailyEquivalent)} по суточной цене.
      </p>
      <Link href={weekHref as never} scroll={false} className="shrink-0 font-semibold text-cta hover:underline">
        Посчитать на 7 дней
      </Link>
    </div>
  );
}
