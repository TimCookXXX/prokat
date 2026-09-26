// Справочник сравнения: города, категории, группы (страницы сравнения) и классы.
// Источник истины для групп и классов — этот файл: `db:sync-catalog` приводит
// таблицы к нему (upsert по slug), админки для них пока нет. Города и категории
// правятся в админке, поэтому синхронизация только создаёт недостающие.
//
// Новая категория или класс — это новые данные здесь, а не новый код.

import type { seoWord } from "@db/schema";

export type SeoWord = (typeof seoWord.enumValues)[number];

export interface CatalogCity {
  slug: string;
  name: string;
  namePrepositional: string;
  region: string;
  lat: number;
  lon: number;
}

export interface CatalogClass {
  slug: string;
  name: string;
  shortHint?: string;
}

export interface CatalogGroup {
  /** URL страницы сравнения: /{city}/{slug}. */
  slug: string;
  name: string;
  /** Для заголовка «{Прокат|Аренда} {nameGenitive} в {городе}». */
  nameGenitive: string;
  seoWord: SeoWord;
  /** Справка под фильтрами: чем классы группы отличаются. */
  guide?: string;
  /** Как ещё это ищут: разговорные названия, сокращения. Имя группы и классов искать и так. */
  keywords?: string[];
  classes: CatalogClass[];
}

export interface CatalogCategory {
  slug: string;
  name: string;
  vertical: string;
  groups: CatalogGroup[];
}

export const CATALOG_CITIES: CatalogCity[] = [
  {
    slug: "krasnodar",
    name: "Краснодар",
    namePrepositional: "Краснодаре",
    region: "Краснодарский край",
    lat: 45.0355,
    lon: 38.9753,
  },
];

export const DEFAULT_CITY_SLUG = "krasnodar";

/** Сегмент списка прокатов: /{city}/prokaty и /{city}/prokaty/{shop}. Группой быть не может. */
export const SHOPS_SEGMENT = "prokaty";

export const CATALOG: CatalogCategory[] = [
  {
    // Слаг совпадает с корневой категорией P2P-сида: справочник категорий общий.
    slug: "instrumenty",
    name: "Инструменты",
    vertical: "tools",
    groups: [
      {
        slug: "prokat-perforatora",
        name: "Перфоратор",
        nameGenitive: "перфоратора",
        seoWord: "prokat",
        guide: "SDS-plus (2–4 Дж) — дюбели, штробы, плитка. SDS-max (5–12 Дж) — монолит, проёмы, демонтаж.",
        keywords: ["перф", "бурилка", "перфик", "sds", "бур"],
        classes: [
          { slug: "perforator-sds-plus", name: "Перфоратор SDS-plus", shortHint: "2–4 Дж · дюбели, штробы, плитка" },
          { slug: "perforator-sds-max", name: "Перфоратор SDS-max", shortHint: "5–12 Дж · монолит, проёмы, демонтаж" },
        ],
      },
      {
        slug: "prokat-otboynogo-molotka",
        name: "Отбойный молоток",
        nameGenitive: "отбойного молотка",
        seoWord: "prokat",
        guide: "До 20 Дж — плитка, стяжка, кирпичные перегородки. Свыше 20 Дж — бетон, фундамент, асфальт.",
        keywords: ["отбойник", "отбойный", "молоток", "демонтаж", "долбёжник", "бетонолом"],
        classes: [
          { slug: "otboynyy-molotok-do-20-dzh", name: "Отбойный молоток до 20 Дж", shortHint: "плитка, стяжка, кирпич" },
          { slug: "otboynyy-molotok-ot-20-dzh", name: "Отбойный молоток свыше 20 Дж", shortHint: "бетон, фундамент, асфальт" },
        ],
      },
      {
        slug: "prokat-betonomeshalki",
        name: "Бетономешалка",
        nameGenitive: "бетономешалки",
        seoWord: "prokat",
        guide: "До 160 л — дорожки, отмостка, небольшие заливки. Свыше 160 л — фундамент и большие объёмы.",
        keywords: ["бетономешалка", "миксер", "мешалка", "бетон", "раствор"],
        classes: [
          { slug: "betonomeshalka-do-160-l", name: "Бетономешалка до 160 л", shortHint: "дорожки, отмостка, небольшие заливки" },
          { slug: "betonomeshalka-ot-160-l", name: "Бетономешалка свыше 160 л", shortHint: "фундамент, большие объёмы" },
        ],
      },
      {
        slug: "prokat-vibroplity",
        name: "Виброплита",
        nameGenitive: "виброплиты",
        seoWord: "prokat",
        guide: "До 100 кг — плитка, дорожки, песок. Свыше 100 кг — щебень, основание под площадки и фундамент.",
        keywords: ["виброплита", "трамбовка", "виброкаток", "уплотнение"],
        classes: [
          { slug: "vibroplita-do-100-kg", name: "Виброплита до 100 кг", shortHint: "плитка, дорожки, песок" },
          { slug: "vibroplita-ot-100-kg", name: "Виброплита свыше 100 кг", shortHint: "щебень, основание площадок" },
        ],
      },
      {
        slug: "prokat-shtroboreza",
        name: "Штроборез",
        nameGenitive: "штробореза",
        seoWord: "prokat",
        keywords: ["штроборез", "бороздодел", "штроба"],
        classes: [
          { slug: "shtroborez", name: "Штроборез", shortHint: "штробы под проводку и трубы" },
        ],
      },
      {
        slug: "prokat-generatora",
        name: "Генератор",
        nameGenitive: "генератора",
        seoWord: "prokat",
        guide: "До 3 кВт — свет, электроинструмент, бытовые приборы. 3–7 кВт — стройка, дом, несколько потребителей сразу.",
        keywords: ["генератор", "электростанция", "бензогенератор", "дизельгенератор"],
        classes: [
          { slug: "generator-do-3-kvt", name: "Генератор до 3 кВт", shortHint: "свет, инструмент, бытовые приборы" },
          { slug: "generator-3-7-kvt", name: "Генератор 3–7 кВт", shortHint: "стройка, дом, несколько потребителей" },
        ],
      },
      {
        slug: "prokat-vyshki-tury",
        name: "Вышка-тура",
        nameGenitive: "вышки-туры",
        seoWord: "prokat",
        keywords: ["вышка", "тура", "леса", "подмости"],
        classes: [
          { slug: "vyshka-tura", name: "Вышка-тура", shortHint: "фасады, потолки, работы на высоте" },
        ],
      },
      {
        slug: "prokat-bolgarki",
        name: "УШМ (болгарка)",
        nameGenitive: "болгарки",
        seoWord: "prokat",
        guide: "Диск 125 мм — металл, профиль, плитка. Диск 230 мм — бетон, камень, толстый металл.",
        keywords: ["болгарка", "ушм", "угловая шлифмашина", "шлифмашина", "турбинка"],
        classes: [
          { slug: "ushm-125", name: "УШМ 125 мм", shortHint: "металл, профиль, плитка" },
          { slug: "ushm-230", name: "УШМ 230 мм", shortHint: "бетон, камень, толстый металл" },
        ],
      },
      {
        slug: "prokat-moyushchego-pylesosa",
        name: "Моющий пылесос",
        nameGenitive: "моющего пылесоса",
        seoWord: "prokat",
        keywords: ["пылесос", "моющий", "химчистка", "karcher", "керхер"],
        classes: [
          { slug: "moyushchiy-pylesos", name: "Моющий пылесос", shortHint: "химчистка мебели, ковров, салона авто" },
        ],
      },
      {
        slug: "prokat-paroochistitelya",
        name: "Пароочиститель",
        nameGenitive: "пароочистителя",
        seoWord: "prokat",
        keywords: ["пароочиститель", "парогенератор", "отпариватель"],
        classes: [
          { slug: "paroochistitel", name: "Пароочиститель", shortHint: "уборка без химии, швы плитки, кухня" },
        ],
      },
    ],
  },
  {
    // Электровелосипеды для курьеров сравниваются по модели: страница = модель.
    slug: "elektrovelosipedy",
    name: "Электровелосипеды",
    vertical: "ebikes",
    groups: [
      ebikeModel("maikaolin-h10", "Maikaolin H10"),
      ebikeModel("maikaolin-u5", "Maikaolin U5"),
      ebikeModel("maikaolin-r7", "Maikaolin R7"),
      ebikeModel("kugoo-v3-pro", "Kugoo V3 Pro"),
      ebikeModel("kugoo-u5", "Kugoo U5"),
    ],
  },
];

function ebikeModel(slug: string, model: string): CatalogGroup {
  return {
    slug: `arenda-elektrovelosipeda-${slug}`,
    name: `Электровелосипед ${model}`,
    nameGenitive: `электровелосипеда ${model}`,
    seoWord: "arenda",
    keywords: ["электровелосипед", "велосипед", "электровел", "велик", "ebike", "курьер"],
    classes: [{ slug: `elektrovelosiped-${slug}`, name: `Электровелосипед ${model}` }],
  };
}
