// Справочник брендов и моделей (ТЗ, п. 2.1). Модель — конкретное изделие; модели
// одного семейства (HR2470, HR2470FT) — одна модель, варианты — в aliases.
// `db:sync-catalog` приводит brands, product_models и model_aliases к этому файлу.
// Характеристики и фото заполняются со ссылкой на источник (specsSourceUrl).
//
// Новая модель — строка в MODELS; если бренда нет — сначала строка в BRANDS.

export interface CatalogBrand {
  slug: string;
  name: string;
  /** Как пишут по-русски и с опечатками: «Макита», «Керхер». */
  aliases: string[];
}

export interface CatalogModel {
  brand: string;
  /** Без бренда: «HR2470», «Puzzi 8/1 C». */
  name: string;
  /** URL страницы модели: /{city}/{seoWord}-{slug}. */
  slug: string;
  /** Класс, в котором сравнивается модель. */
  cls: string;
  /** Семейство — общее имя вариантов: «Puzzi 8/1». */
  family?: string;
  /** Другие написания и варианты исполнения: «HR2470FT», «Puzzi 8/1». */
  aliases?: string[];
  specs?: Record<string, string | number>;
  specsSourceUrl?: string;
}

export const BRANDS: CatalogBrand[] = [
  { slug: "makita", name: "Makita", aliases: ["Макита", "Макиту"] },
  { slug: "bosch", name: "Bosch", aliases: ["Бош"] },
  { slug: "dewalt", name: "DeWalt", aliases: ["Деволт", "Девольт", "Девалт", "De Walt"] },
  { slug: "hilti", name: "Hilti", aliases: ["Хилти"] },
  { slug: "hitachi", name: "Hitachi", aliases: ["Хитачи", "HiKOKI", "Хикоки"] },
  { slug: "metabo", name: "Metabo", aliases: ["Метабо"] },
  { slug: "interskol", name: "Интерскол", aliases: ["Interskol"] },
  { slug: "zubr", name: "Зубр", aliases: ["Zubr"] },
  { slug: "karcher", name: "Karcher", aliases: ["Kärcher", "Керхер", "Кёрхер", "Кархер", "Карчер"] },
  { slug: "fubag", name: "Fubag", aliases: ["Фубаг"] },
  { slug: "huter", name: "Huter", aliases: ["Хутер", "Хьютер"] },
  { slug: "champion", name: "Champion", aliases: ["Чемпион"] },
];

export const MODELS: CatalogModel[] = [
  // Перфораторы SDS-plus
  { brand: "makita", name: "HR2470", slug: "makita-hr2470", cls: "perforator-sds-plus", family: "HR2470", aliases: ["HR2470FT", "HR2470F", "HR2470X5"] },
  { brand: "makita", name: "HR2630", slug: "makita-hr2630", cls: "perforator-sds-plus", family: "HR2630", aliases: ["HR2630T", "HR2630X5"] },
  { brand: "bosch", name: "GBH 2-26", slug: "bosch-gbh-2-26", cls: "perforator-sds-plus", family: "GBH 2-26", aliases: ["GBH 2-26 DRE", "GBH 2-26 DFR", "GBH 2-26 RE"] },
  { brand: "bosch", name: "GBH 2-28", slug: "bosch-gbh-2-28", cls: "perforator-sds-plus", family: "GBH 2-28", aliases: ["GBH 2-28 F", "GBH 2-28 DFV"] },
  { brand: "dewalt", name: "D25133", slug: "dewalt-d25133", cls: "perforator-sds-plus", aliases: ["D25133K"] },
  { brand: "hitachi", name: "DH24PH", slug: "hitachi-dh24ph", cls: "perforator-sds-plus" },
  { brand: "interskol", name: "П-26", slug: "interskol-p-26", cls: "perforator-sds-plus", aliases: ["П-26/800ЭР"] },
  { brand: "zubr", name: "ЗП-26", slug: "zubr-zp-26", cls: "perforator-sds-plus", aliases: ["ЗП-26-750 ЭК"] },
  // Перфораторы SDS-max
  { brand: "makita", name: "HR4013C", slug: "makita-hr4013c", cls: "perforator-sds-max" },
  { brand: "bosch", name: "GBH 8-45 DV", slug: "bosch-gbh-8-45-dv", cls: "perforator-sds-max", aliases: ["GBH 8-45 D"] },
  { brand: "hilti", name: "TE 60", slug: "hilti-te-60", cls: "perforator-sds-max", aliases: ["TE 60-ATC"] },
  // Отбойные молотки
  { brand: "makita", name: "HM1203C", slug: "makita-hm1203c", cls: "otboynyy-molotok-do-20-dzh" },
  { brand: "bosch", name: "GSH 5", slug: "bosch-gsh-5", cls: "otboynyy-molotok-do-20-dzh", aliases: ["GSH 5 CE"] },
  { brand: "interskol", name: "М-10/1300", slug: "interskol-m-10-1300", cls: "otboynyy-molotok-do-20-dzh" },
  // Генераторы
  { brand: "fubag", name: "BS 2200", slug: "fubag-bs-2200", cls: "generator-do-3-kvt" },
  { brand: "huter", name: "DY3000L", slug: "huter-dy3000l", cls: "generator-do-3-kvt" },
  { brand: "champion", name: "GG3300", slug: "champion-gg3300", cls: "generator-do-3-kvt" },
  // Уборка
  { brand: "karcher", name: "Puzzi 8/1 C", slug: "karcher-puzzi-8-1", cls: "moyushchiy-pylesos", family: "Puzzi 8/1", aliases: ["Puzzi 8/1"] },
  { brand: "karcher", name: "Puzzi 10/1", slug: "karcher-puzzi-10-1", cls: "moyushchiy-pylesos", family: "Puzzi 10/1" },
  { brand: "karcher", name: "SC 4", slug: "karcher-sc-4", cls: "paroochistitel", family: "SC 4", aliases: ["SC 4 EasyFix"] },
  { brand: "karcher", name: "WD 3", slug: "karcher-wd-3", cls: "stroitelnyy-pylesos", family: "WD 3", aliases: ["WD 3 P"] },
];
