// Демо-прокаты и цены для dev: вымышленные прокаты Краснодара из макетов и
// тестов расчёта (docs/inrenta-pivot/code/pricing.test.ts). Даты проверки —
// относительно сегодняшнего дня, чтобы выдача не «протухала»; у одного
// предложения дата старше 30 дней — для блока «на перепроверке».
// В production не создаются.

import type { OfferRow } from "../src/lib/compare/offers-csv";
import { addDaysStr } from "../src/lib/catalog/dates";

const SHOPS = {
  a: { shopName: "Инструмент у дома", district: "ЮМР", phone: "+79001000001" },
  b: { shopName: "Бур и Молот", district: "ФМР", phone: "+79001000002" },
  c: { shopName: "РемПрокат-23", district: "Гидрострой", phone: "+79001000003" },
  d: { shopName: "Склад на Уральской", district: "Энка", phone: "+79001000004" },
  e: { shopName: "Мастерская Фёдорова", district: "ЧМР", phone: "+79001000005" },
  f: { shopName: "Точка инструмента", district: "Центр", phone: "+79001000006" },
  g: { shopName: "Дрель и Ко", district: "Музыкальный", phone: "+79001000007" },
  h: { shopName: "Прокат «Кран-Балка»", district: "Фестивальный", phone: "+79001000008" },
} as const;

type Shop = keyof typeof SHOPS;

interface Demo {
  shop: Shop;
  cls: string;
  model: string;
  day: number;
  week?: number;
  minDays?: number;
  deposit: number | null;
  doc?: boolean;
  /** null — только самовывоз. */
  delivery: { price: number; freeFrom?: number; sameDay?: boolean } | null;
  /** Сколько дней назад проверена цена. */
  ago: number;
}

const DEMO: Demo[] = [
  // Перфоратор SDS-plus — ровно набор из макетов и pricing.test.ts.
  { shop: "a", cls: "perforator-sds-plus", model: "Makita HR2470", day: 450, week: 2400, deposit: 3000, delivery: { price: 400, freeFrom: 2000 }, ago: 5 },
  { shop: "b", cls: "perforator-sds-plus", model: "Bosch GBH 2-26", day: 500, deposit: 0, doc: true, delivery: { price: 350 }, ago: 8 },
  { shop: "c", cls: "perforator-sds-plus", model: "Интерскол П-26", day: 350, minDays: 2, deposit: 2000, delivery: null, ago: 3 },
  { shop: "d", cls: "perforator-sds-plus", model: "DeWalt D25133", day: 600, week: 3000, deposit: 5000, delivery: { price: 500, freeFrom: 3000 }, ago: 11 },
  { shop: "e", cls: "perforator-sds-plus", model: "Hitachi DH24PH", day: 400, deposit: 2000, doc: true, delivery: { price: 300 }, ago: 52 },
  { shop: "f", cls: "perforator-sds-plus", model: "Bosch GBH 2-28", day: 900, deposit: 10000, delivery: { price: 0, sameDay: true }, ago: 4 },
  { shop: "g", cls: "perforator-sds-plus", model: "Makita HR2630", day: 550, week: 2800, deposit: 3000, delivery: { price: 450, sameDay: true }, ago: 6 },
  { shop: "h", cls: "perforator-sds-plus", model: "Зубр ЗП-26", day: 380, minDays: 3, deposit: 1500, delivery: { price: 350 }, ago: 7 },
  // Перфоратор SDS-max.
  { shop: "b", cls: "perforator-sds-max", model: "Bosch GBH 8-45 DV", day: 1400, deposit: 0, doc: true, delivery: { price: 350 }, ago: 8 },
  { shop: "d", cls: "perforator-sds-max", model: "Makita HR4013C", day: 1500, week: 7500, deposit: 10000, delivery: { price: 500, freeFrom: 3000 }, ago: 11 },
  { shop: "f", cls: "perforator-sds-max", model: "Hilti TE 60", day: 1800, deposit: 15000, delivery: { price: 0, sameDay: true }, ago: 4 },
  // Отбойный молоток до 20 Дж.
  { shop: "a", cls: "otboynyy-molotok-do-20-dzh", model: "Makita HM1203C", day: 900, week: 4500, deposit: 5000, delivery: { price: 400, freeFrom: 2000 }, ago: 5 },
  { shop: "c", cls: "otboynyy-molotok-do-20-dzh", model: "Интерскол М-10/1300", day: 700, minDays: 2, deposit: 3000, delivery: null, ago: 3 },
  { shop: "g", cls: "otboynyy-molotok-do-20-dzh", model: "Bosch GSH 5", day: 950, deposit: 5000, delivery: { price: 450, sameDay: true }, ago: 6 },
  // Генератор до 3 кВт.
  { shop: "a", cls: "generator-do-3-kvt", model: "Fubag BS 2200", day: 1200, week: 6000, deposit: 7000, delivery: { price: 400, freeFrom: 2000 }, ago: 5 },
  { shop: "e", cls: "generator-do-3-kvt", model: "Huter DY3000L", day: 1000, deposit: 5000, delivery: { price: 300 }, ago: 10 },
  { shop: "h", cls: "generator-do-3-kvt", model: "Champion GG3300", day: 1100, minDays: 2, deposit: null, delivery: { price: 350 }, ago: 7 },
];

export function demoOfferRows(today: string): OfferRow[] {
  return DEMO.map((o, i) => ({
    line: i + 1,
    citySlug: "krasnodar",
    ...SHOPS[o.shop],
    address: null,
    website: null,
    classSlug: o.cls,
    model: o.model,
    priceDay: o.day,
    priceWeek: o.week ?? null,
    minDays: o.minDays ?? 1,
    depositRub: o.deposit,
    depositDocument: o.doc ?? false,
    deliveryAvailable: o.delivery !== null,
    deliveryPrice: o.delivery?.price ?? 0,
    deliveryFreeFrom: o.delivery?.freeFrom ?? null,
    deliverySameDay: o.delivery?.sameDay ?? false,
    verifiedAt: addDaysStr(today, -o.ago),
    verifiedBy: "call",
    sourceUrl: null,
  }));
}
