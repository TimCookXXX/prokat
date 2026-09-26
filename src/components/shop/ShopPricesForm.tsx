"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { updateShopOffers } from "@/server/actions/shops";
import { OfferFields, draftToInput, type OfferDraft } from "./OfferFields";

export interface EditableOffer {
  id: string;
  title: string;
  model: string | null;
  isActive: boolean;
  place: string;
  draft: OfferDraft;
}

// Цены проката в кабинете. «Сохранить» обновляет все предложения разом и ставит
// дату проверки — сегодня, проверил сам прокат.
export function ShopPricesForm({ shopId, offers }: { shopId: string; offers: EditableOffer[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(offers);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const patch = (id: string, p: Partial<EditableOffer> | Partial<OfferDraft>, draft = true) =>
    setRows((rs) => rs.map((r) => (r.id !== id ? r : draft ? { ...r, draft: { ...r.draft, ...p } } : { ...r, ...p })));

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        start(async () => {
          const res = await updateShopOffers(shopId, rows.map((r) => ({ id: r.id, isActive: r.isActive, ...draftToInput(r.draft) })));
          if (res.ok) router.refresh(); // место в сравнении пересчитается
          setMsg(res.ok
            ? { ok: true, text: `Сохранено: ${res.data.updated}. В сравнении — сразу, с сегодняшней датой проверки.` }
            : { ok: false, text: res.error === "invalid_input" ? "Проверьте цены" : res.error });
        });
      }}
    >
      {rows.map((r) => (
        <fieldset key={r.id} className="flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card">
          <legend className="sr-only">{r.title}</legend>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="font-semibold">{r.title}</p>
              <p className="text-sm text-muted-foreground">{r.model ?? "модель не указана"}</p>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">Место: <b className="font-semibold text-foreground">{r.place}</b></span>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={r.isActive} onChange={(e) => patch(r.id, { isActive: e.target.checked }, false)} className="h-[18px] w-[18px] accent-primary" />
                В сравнении
              </label>
            </div>
          </div>
          <OfferFields id={r.id} d={r.draft} onChange={(p) => patch(r.id, p)} />
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="cta" pending={pending}>Сохранить цены</Button>
        {msg && <p role="status" className={`text-sm ${msg.ok ? "text-ok" : "text-destructive"}`}>{msg.text}</p>}
      </div>
    </form>
  );
}
