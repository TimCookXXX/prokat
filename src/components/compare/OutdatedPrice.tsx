"use client";

import { useState, useTransition } from "react";
import { reportOutdatedPrice } from "@/server/actions/leads";
import { reachGoal } from "@/lib/analytics";

// «Цена устарела?» — сигнал перепроверить цену звонком.
export function OutdatedPrice({ offerId }: { offerId: string }) {
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  if (done) return <span className="text-xs text-muted-foreground">Спасибо, перепроверим</span>;
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground disabled:opacity-60"
      onClick={() => start(async () => {
        const res = await reportOutdatedPrice({ offerId });
        if (res.ok) {
          setDone(true);
          reachGoal("price_outdated");
        }
      })}
    >
      Цена устарела?
    </button>
  );
}
