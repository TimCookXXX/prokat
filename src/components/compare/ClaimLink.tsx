"use client";

import Link from "next/link";
import { logClaimClick } from "@/server/actions/leads";
import { reachGoal } from "@/lib/analytics";

// «Это ваш прокат? Подтвердить» — считаем интерес прокатов (claim_click) и ведём
// на страницу «Для прокатов» с выбранной карточкой.
export function ClaimLink({ shopId, className, children }: { shopId: string; className?: string; children: React.ReactNode }) {
  return (
    <Link
      href={`/dlya-prokatov?shop=${shopId}` as never}
      className={className}
      onClick={() => {
        reachGoal("claim_click");
        void logClaimClick({ shopId });
      }}
    >
      {children}
    </Link>
  );
}
