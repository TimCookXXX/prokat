// Справочник мест для поля «Где»: округа и микрорайоны. Источник — открытые данные
// OpenStreetMap (© участники OpenStreetMap, лицензия ODbL; указывать источник на
// сайте). Центры микрорайонов — точки OSM, округ — по границам из okrug-bounds.ts.
// Принадлежность к округам сверяется с данными администрации города.
//
// Как и каталог, это данные, а не код: `db:sync-catalog` приводит таблицу districts
// к этому файлу (upsert по slug). Новый микрорайон — одна строка ниже.

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface CatalogOkrug extends GeoPoint {
  slug: string;
  name: string;
  /** «Прикубанский», «ПВО» — как ещё его называют. Название ищется и так. */
  aliases: string[];
}

export interface CatalogMicrodistrict extends GeoPoint {
  slug: string;
  name: string;
  okrug: string;
  /** Сокращения и разговорные названия: ФМР, Фестивалка. */
  aliases: string[];
}

export interface CatalogCityGeo {
  citySlug: string;
  okrugs: CatalogOkrug[];
  microdistricts: CatalogMicrodistrict[];
}

export const CITY_GEO: CatalogCityGeo[] = [
  {
    citySlug: "krasnodar",
    // Центр — для подписи на карте, не для расчёта: у округа расстояние не считаем.
    okrugs: [
      { slug: "zapadnyy", name: "Западный округ", lat: 45.035, lon: 38.945, aliases: ["Западный", "ЗВО", "Западный внутригородской округ"] },
      { slug: "tsentralnyy", name: "Центральный округ", lat: 45.025, lon: 38.995, aliases: ["Центральный", "ЦВО", "Центральный внутригородской округ"] },
      { slug: "karasunskiy", name: "Карасунский округ", lat: 45.035, lon: 39.085, aliases: ["Карасунский", "КВО", "Карасунский внутригородской округ"] },
      { slug: "prikubanskiy", name: "Прикубанский округ", lat: 45.08, lon: 38.97, aliases: ["Прикубанский", "ПВО", "Прикубанский внутригородской округ"] },
    ],
    microdistricts: [
      // Западный
      { slug: "yubileynyy", name: "Юбилейный", okrug: "zapadnyy", lat: 45.031, lon: 38.9124, aliases: ["ЮМР", "Юбилейка"] },
      { slug: "tsentr", name: "Центр", okrug: "zapadnyy", lat: 45.0356, lon: 38.9708, aliases: ["центр города", "исторический центр", "Сенной рынок"] },
      // Центральный
      { slug: "tabachnaya-fabrika", name: "Табачная фабрика", okrug: "tsentralnyy", lat: 45.0284, lon: 38.9724, aliases: ["Табачка"] },
      // Карасунский
      { slug: "cheremushki", name: "Черёмушки", okrug: "karasunskiy", lat: 45.027, lon: 39.0184, aliases: ["ЧМР"] },
      { slug: "komsomolskiy", name: "Комсомольский", okrug: "karasunskiy", lat: 45.0345, lon: 39.0958, aliases: ["КМР", "Комсомолка"] },
      { slug: "pashkovskiy", name: "Пашковский", okrug: "karasunskiy", lat: 45.0239, lon: 39.095, aliases: ["Пашковка"] },
      { slug: "novoznamenskiy", name: "Новознаменский", okrug: "karasunskiy", lat: 45.0522, lon: 39.1187, aliases: [] },
      { slug: "gidrostroy", name: "Гидрострой", okrug: "karasunskiy", lat: 45.0091, lon: 39.0722, aliases: ["ГМР", "Гидростроителей", "Гидра"] },
      { slug: "sosnovyy-bor", name: "Сосновый Бор", okrug: "karasunskiy", lat: 45.0696, lon: 39.1281, aliases: [] },
      { slug: "khutor-lenina", name: "Хутор Ленина", okrug: "karasunskiy", lat: 45.0186, lon: 39.2103, aliases: [] },
      // Прикубанский
      { slug: "festivalnyy", name: "Фестивальный", okrug: "prikubanskiy", lat: 45.0621, lon: 38.952, aliases: ["ФМР", "Фестивалка"] },
      { slug: "slavyanskiy", name: "Славянский", okrug: "prikubanskiy", lat: 45.0634, lon: 38.9288, aliases: [] },
      { slug: "solnechnyy", name: "Солнечный", okrug: "prikubanskiy", lat: 45.065, lon: 38.9542, aliases: [] },
      { slug: "aviagorodok", name: "Авиагородок", okrug: "prikubanskiy", lat: 45.0762, lon: 38.9725, aliases: [] },
      { slug: "zip", name: "ЗИП", okrug: "prikubanskiy", lat: 45.0712, lon: 38.986, aliases: ["Завод измерительных приборов"] },
      { slug: "kkb", name: "ККБ", okrug: "prikubanskiy", lat: 45.063, lon: 39.0197, aliases: ["Краевая больница", "Краевая клиническая больница"] },
      { slug: "panorama", name: "Панорама", okrug: "prikubanskiy", lat: 45.0477, lon: 39.0263, aliases: [] },
      { slug: "gubernskiy", name: "Губернский", okrug: "prikubanskiy", lat: 45.0738, lon: 39.0385, aliases: [] },
      { slug: "lyubimovo", name: "Любимово", okrug: "prikubanskiy", lat: 45.0831, lon: 39.0399, aliases: [] },
      { slug: "divnyy", name: "Дивный", okrug: "prikubanskiy", lat: 45.0857, lon: 39.0964, aliases: [] },
      { slug: "rossiyskiy", name: "Российский", okrug: "prikubanskiy", lat: 45.1175, lon: 39.0453, aliases: ["посёлок Российский"] },
      { slug: "samolet", name: "Самолёт", okrug: "prikubanskiy", lat: 45.099, lon: 38.9047, aliases: [] },
      { slug: "krasnaya-ploshchad", name: "Красная площадь", okrug: "prikubanskiy", lat: 45.1097, lon: 38.9649, aliases: [] },
      { slug: "kalinino", name: "Калинино", okrug: "prikubanskiy", lat: 45.1087, lon: 38.9387, aliases: [] },
      { slug: "gorkhutor", name: "Горхутор", okrug: "prikubanskiy", lat: 45.1117, lon: 38.9896, aliases: [] },
      { slug: "nemetskaya-derevnya", name: "Немецкая деревня", okrug: "prikubanskiy", lat: 45.1198, lon: 38.9272, aliases: ["НД"] },
      { slug: "parkovyy", name: "Парковый", okrug: "prikubanskiy", lat: 45.1224, lon: 38.9578, aliases: [] },
      { slug: "severnyy", name: "Северный", okrug: "prikubanskiy", lat: 45.1276, lon: 38.9714, aliases: [] },
      { slug: "molodezhnyy", name: "Молодёжный", okrug: "prikubanskiy", lat: 45.1425, lon: 38.9918, aliases: [] },
      { slug: "vitaminkombinat", name: "Витаминкомбинат", okrug: "prikubanskiy", lat: 45.1502, lon: 38.997, aliases: ["Витаминка"] },
    ],
  },
];
