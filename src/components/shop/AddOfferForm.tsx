"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addShopOffer } from "@/server/actions/shops";
import { INPUT, OfferFields, draftToInput, type OfferDraft } from "./OfferFields";

const EMPTY: OfferDraft = {
  priceDay: "", priceWeek: "", minDays: "1", depositRub: "", depositDocument: false,
  deliveryAvailable: false, deliveryPrice: "", deliveryFreeFrom: "", deliverySameDay: false,
};

// «Добавить инструмент»: новое предложение проката в одном из классов справочника.
export function AddOfferForm({ shopId, classes }: { shopId: string; classes: { group: string; items: { slug: string; name: string }[] }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [classSlug, setClassSlug] = useState(classes[0]?.items[0]?.slug ?? "");
  const [model, setModel] = useState("");
  const [d, setD] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}>Добавить инструмент</Button>;
  return (
    <form
      className="flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await addShopOffer(shopId, { classSlug, model, ...draftToInput(d) });
          if (!res.ok) { setError(res.error === "invalid_input" ? "Проверьте цены" : res.error); return; }
          setOpen(false); setModel(""); setD(EMPTY);
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Что сдаёте
          <select value={classSlug} onChange={(e) => setClassSlug(e.target.value)} className={INPUT}>
            {classes.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.items.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Модель
          <input value={model} onChange={(e) => setModel(e.target.value)} maxLength={120} placeholder="Makita HR2470" className={INPUT} />
        </label>
      </div>
      <OfferFields id="new" d={d} onChange={(p) => setD((x) => ({ ...x, ...p }))} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" pending={pending}>Добавить</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
      </div>
    </form>
  );
}
