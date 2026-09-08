import { ruPlural } from "@/lib/plural";

// 1500 -> "1 500 ₽" (неразрывные пробелы в числе и перед ₽).
export function formatPrice(rub: number): string {
  const grouped = new Intl.NumberFormat("ru-RU").format(rub);
  return `${grouped} ₽`;
}

export function formatDeposit(type: "money" | "document" | "none", amount: number | null): string {
  if (type === "none") return "без залога";
  if (type === "document") return "залог: документ";
  // Тип «деньги» без суммы: владелец выбрал залог, но не сказал какой. Голое
  // «залог» ничего не сообщало — ноль здесь то же «значения нет», что и пустое
  // поле, и оба честнее назвать вслух.
  return amount ? `залог ${formatPrice(amount)}` : "залог не указан";
}

// Значение к подписи «Получение» в блоке брони — короткое, как «залог 3 000 ₽»
// рядом. Развёрнутой фразы больше нет: единственным местом показа остался
// виджет, где на строку есть половина ширины.
// Ни одного способа быть не должно (validation.ts этого не пропустит), но
// колонки живут в БД и правятся не только формой, поэтому случай назван вслух,
// а не выдаёт «только самовывоз» за отсутствие данных.
export function formatHandover(pickup: boolean, delivery: boolean): string {
  if (pickup && delivery) return "Самовывоз или доставка";
  if (pickup) return "Только самовывоз";
  if (delivery) return "Только доставка";
  return "По договорённости";
}

// Тот же смысл для подвала карточки в выдаче, но короче и другим тоном: в
// блоке брони «Только самовывоз» предупреждает об ограничении и это уместно, а
// карточка в ряду просто перечисляет. Косая черта вместо «или» — в подвале
// рядом стоит город, и на узкой карточке фраза целиком не помещалась.
export function formatHandoverShort(pickup: boolean, delivery: boolean): string {
  if (pickup && delivery) return "Самовывоз / доставка";
  if (pickup) return "Самовывоз";
  if (delivery) return "Доставка";
  return "По договорённости";
}

export function listingsCountLabel(n: number): string {
  return `${n} ${ruPlural(n, "позиция", "позиции", "позиций")}`;
}

export function ownersCountLabel(n: number): string {
  return `${n} ${ruPlural(n, "продавец", "продавца", "продавцов")}`;
}
