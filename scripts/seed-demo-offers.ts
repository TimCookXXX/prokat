// Демо-прокаты и цены для dev: вымышленные прокаты Краснодара из макетов и
// тестов расчёта (docs/inrenta-pivot/code/pricing.test.ts). Даты проверки —
// относительно сегодняшнего дня, чтобы выдача не «протухала»; у одного
// предложения дата старше 30 дней — для блока «на перепроверке».
// В production не создаются.

import type { OfferRow } from "../src/lib/compare/offers-csv";
import { addDaysStr } from "../src/lib/catalog/dates";
import { parseHours } from "../src/lib/compare/hours";

interface DemoShop {
  shopName: string;
  phone: string;
  microdistrict: string | null;
  /** Вымышленный адрес с точкой внутри микрорайона; null — «адрес уточняйте». */
  address?: string;
  lat?: number;
  lon?: number;
  hours?: string;
  telegram?: string;
}

// «Дрель и Ко» — без адреса и микрорайона: прокат без местоположения.
const SHOPS = {
  a: { shopName: "Инструмент у дома", microdistrict: "ЮМР", phone: "+79001000001", address: "ул. Рождественская набережная, 5", lat: 45.028, lon: 38.908, hours: "пн-пт 9-20; сб 10-16; вс выходной" },
  b: { shopName: "Бур и Молот", microdistrict: "ФМР", phone: "+79001000002", hours: "ежедневно 8-21" },
  c: { shopName: "РемПрокат-23", microdistrict: "Гидрострой", phone: "+79001000003", address: "ул. Гидростроителей, 20", lat: 45.004, lon: 39.08, hours: "пн-сб 9-19; вс выходной" },
  d: { shopName: "Склад на Уральской", microdistrict: "КМР", phone: "+79001000004", address: "ул. Уральская, 150", lat: 45.04, lon: 39.085 },
  e: { shopName: "Мастерская Фёдорова", microdistrict: "ЧМР", phone: "+79001000005" },
  f: { shopName: "Точка инструмента", microdistrict: "Центр", phone: "+79001000006", address: "ул. Красная, 120", lat: 45.04, lon: 38.976, hours: "круглосуточно" },
  g: { shopName: "Дрель и Ко", microdistrict: null, phone: "+79001000007" },
  h: { shopName: "Прокат «Кран-Балка»", microdistrict: "Славянский", phone: "+79001000008", hours: "пн-пт 8-18" },
  i: { shopName: "ЧистоПрокат", microdistrict: "Солнечный", phone: "+79001000009", address: "ул. Солнечная, 30", lat: 45.066, lon: 38.956, hours: "ежедневно 9-21", telegram: "chistoprokat_krd" },
} satisfies Record<string, DemoShop>;

type Shop = keyof typeof SHOPS;

interface Demo {
  shop: Shop;
  cls: string;
  /** null — модель не указана: предложение класса. */
  model: string | null;
  includes?: string;
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
  // Без модели — показываются при поиске по классу, но не по модели.
  { shop: "h", cls: "perforator-sds-max", model: null, day: 1200, deposit: 5000, delivery: { price: 350 }, ago: 7 },
  { shop: "d", cls: "stroitelnyy-pylesos", model: null, day: 650, deposit: 3000, delivery: null, ago: 11 },
  // Уборка: Karcher Puzzi — разные написания одной модели у разных прокатов.
  { shop: "i", cls: "moyushchiy-pylesos", model: "Karcher Puzzi 8/1 C", day: 900, week: 4500, deposit: 3000, includes: "моющее средство, насадка для мебели", delivery: { price: 300 }, ago: 2 },
  { shop: "a", cls: "moyushchiy-pylesos", model: "Karcher Puzzi 8/1", day: 1000, deposit: 0, doc: true, includes: "моющее средство", delivery: { price: 400 }, ago: 5 },
  { shop: "f", cls: "moyushchiy-pylesos", model: "Керхер Puzzi 8/1 C", day: 1100, deposit: 5000, delivery: { price: 0, sameDay: true }, ago: 4 },
  { shop: "b", cls: "moyushchiy-pylesos", model: "Karcher Puzzi 10/1", day: 1400, week: 7000, deposit: 5000, includes: "моющее средство, 2 насадки", delivery: null, ago: 8 },
  { shop: "i", cls: "paroochistitel", model: "Karcher SC 4", day: 600, deposit: 2000, delivery: { price: 300 }, ago: 2 },
  { shop: "a", cls: "paroochistitel", model: "Karcher SC 4 EasyFix", day: 700, deposit: 0, doc: true, delivery: { price: 400 }, ago: 5 },
  { shop: "c", cls: "stroitelnyy-pylesos", model: "Karcher WD 3", day: 500, deposit: 2000, delivery: null, ago: 3 },
];

export function demoOfferRows(today: string): OfferRow[] {
  return DEMO.map((o, i) => {
    const shop: DemoShop = SHOPS[o.shop];
    return {
      line: i + 1,
      citySlug: "krasnodar",
      shopName: shop.shopName,
      microdistrict: shop.microdistrict,
      address: shop.address ?? null,
      lat: shop.lat ?? null,
      lon: shop.lon ?? null,
      hours: shop.hours ? parseHours(shop.hours) : null,
      telegram: shop.telegram ?? null,
      phone: shop.phone,
      website: null,
      classSlug: o.cls,
      model: o.model,
      includes: o.includes ?? null,
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
    };
  });
}
