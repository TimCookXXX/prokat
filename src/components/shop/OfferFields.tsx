"use client";

// Поля цены и условий одного предложения — общие для правки и добавления.

export interface OfferDraft {
  priceDay: string;
  priceWeek: string;
  minDays: string;
  /** Пусто — залог «уточняется». */
  depositRub: string;
  depositDocument: boolean;
  deliveryAvailable: boolean;
  deliveryPrice: string;
  deliveryFreeFrom: string;
  deliverySameDay: boolean;
}

export const INPUT = "h-10 w-full rounded-md border border-border bg-card px-2.5 text-[15px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring";

const num = (s: string): number | null => {
  const t = s.replace(/[\s ₽]/g, "");
  return t === "" ? null : Number(t);
};

/** Черновик → вход для server action (числа, null для пустых). */
export function draftToInput(d: OfferDraft) {
  return {
    priceDay: num(d.priceDay),
    priceWeek: num(d.priceWeek),
    minDays: num(d.minDays) ?? 1,
    depositRub: num(d.depositRub),
    depositDocument: d.depositDocument,
    deliveryAvailable: d.deliveryAvailable,
    deliveryPrice: num(d.deliveryPrice) ?? 0,
    deliveryFreeFrom: num(d.deliveryFreeFrom),
    deliverySameDay: d.deliverySameDay,
  };
}

export function OfferFields({ id, d, onChange }: { id: string; d: OfferDraft; onChange: (patch: Partial<OfferDraft>) => void }) {
  const field = (key: keyof OfferDraft, label: string, placeholder = "") => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <input
        inputMode="numeric"
        value={d[key] as string}
        placeholder={placeholder}
        onChange={(e) => onChange({ [key]: e.target.value } as Partial<OfferDraft>)}
        className={INPUT}
        id={`${id}-${key}`}
      />
    </label>
  );
  const check = (key: keyof OfferDraft, label: string, disabled = false) => (
    <label className={`flex min-h-[40px] items-center gap-2 text-sm ${disabled ? "text-muted-foreground" : ""}`}>
      <input
        type="checkbox"
        checked={d[key] as boolean}
        disabled={disabled}
        onChange={(e) => onChange({ [key]: e.target.checked } as Partial<OfferDraft>)}
        className="h-[18px] w-[18px] accent-primary"
      />
      {label}
    </label>
  );
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {field("priceDay", "₽ / сутки", "только понедельно")}
      {field("priceWeek", "₽ / неделя", "нет тарифа")}
      {field("minDays", "Мин. срок, суток", "1")}
      {field("depositRub", "Залог, ₽", "уточняется")}
      {check("depositDocument", "Берём паспорт")}
      {check("deliveryAvailable", "Есть доставка")}
      {field("deliveryPrice", "Доставка, ₽", "0")}
      {field("deliveryFreeFrom", "Бесплатно от, ₽", "—")}
      {check("deliverySameDay", "Привезём в день заказа", !d.deliveryAvailable)}
    </div>
  );
}
