// Дерево категорий — справочник, а не демо-данные: на слаги отсюда завязаны
// адреса каталога. Живёт отдельным модулем, потому что заводить его должен
// каждый сид, и оба обязаны работать на чистой базе поодиночке. Раньше дерево
// лежало внутри scripts/seed.ts вперемешку с демо-городом, и второй сид не мог
// подняться, не притащив Казань.
//
// vertical у подкатегории тот же, что у корня, — грубая группировка ниш.
// Явный slug задаётся там, где имя повторяется в разных ветках: «Аксессуары»
// есть и в одежде, и в электронике, а слаг у категории один на всю таблицу.

export interface SeedCategoryChild {
  name: string;
  /** Если не задан — slugify(name). */
  slug?: string;
}

export interface SeedCategoryRoot {
  name: string;
  vertical: string;
  children: SeedCategoryChild[];
}

export const SEED_CATEGORIES: SeedCategoryRoot[] = [
  {
    name: "Инструменты", vertical: "tools",
    children: [
      { name: "Электроинструменты" },
      { name: "Ручной инструмент" },
      { name: "Садовая техника" },
      { name: "Строительное оборудование" },
    ],
  },
  {
    name: "Одежда", vertical: "clothing",
    children: [
      { name: "Вечерняя одежда" },
      { name: "Свадебная одежда" },
      { name: "Костюмы" },
      { name: "Аксессуары", slug: "aksessuary-odezhda" },
    ],
  },
  {
    name: "Фото и видео", vertical: "photo",
    children: [
      { name: "Камеры" },
      { name: "Объективы" },
      { name: "Освещение" },
      { name: "Штативы и стабилизаторы" },
      { name: "Дроны" },
      { name: "Экшн-камеры" },
    ],
  },
  {
    name: "Транспорт", vertical: "transport",
    children: [
      { name: "Велосипеды" },
      { name: "Электросамокаты" },
      { name: "Автомобили" },
      { name: "Прицепы" },
      { name: "Водный транспорт" },
    ],
  },
  {
    name: "Туризм и отдых", vertical: "outdoor",
    children: [
      { name: "Палатки" },
      { name: "Спальники" },
      { name: "Рюкзаки" },
      { name: "Кемпинг-оборудование" },
      { name: "Туристическая посуда" },
    ],
  },
  {
    name: "Развлечения", vertical: "entertainment",
    children: [
      { name: "Игровые приставки" },
      { name: "VR" },
      { name: "Настольные игры" },
      { name: "Проекторы" },
    ],
  },
  {
    name: "Детские товары", vertical: "kids",
    children: [
      { name: "Коляски" },
      { name: "Автокресла" },
      { name: "Игрушки" },
      { name: "Стульчики для кормления" },
    ],
  },
  {
    name: "Дом и мероприятия", vertical: "home",
    children: [
      { name: "Мебель" },
      { name: "Декор" },
      { name: "Шатры и тенты" },
      { name: "Грили и барбекю" },
      { name: "Уборочная техника" },
    ],
  },
  {
    name: "Электроника", vertical: "electronics",
    children: [
      { name: "Ноутбуки" },
      { name: "Планшеты" },
      { name: "Смартфоны" },
      { name: "Мониторы" },
      { name: "Аксессуары", slug: "aksessuary-elektronika" },
    ],
  },
  {
    name: "Спорт", vertical: "sport",
    children: [
      { name: "Тренажеры" },
      { name: "Фитнес-инвентарь" },
      { name: "Зимний спорт" },
      { name: "Велоспорт" },
      { name: "Водный спорт" },
    ],
  },
];

/** Разделитель пути в CSV: «Инструменты / Электроинструменты». */
export const CATEGORY_PATH_SEPARATOR = "/";

/** Канонический вид пути — по нему сверяются ячейки CSV. */
export function categoryPath(root: string, child: string): string {
  return `${root} ${CATEGORY_PATH_SEPARATOR} ${child}`;
}

/**
 * Разбирает ячейку `category` в пару имён. Пробелы вокруг разделителя
 * необязательны: человек в таблице напишет и «Инструменты/Ручной инструмент».
 */
export function parseCategoryPath(raw: string): { root: string; child: string } | null {
  const parts = raw.split(CATEGORY_PATH_SEPARATOR).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  return { root: parts[0], child: parts[1] };
}

/** Все пути дерева — и для сверки, и для подсказки в сообщении об ошибке. */
export function allCategoryPaths(): string[] {
  return SEED_CATEGORIES.flatMap((root) =>
    root.children.map((child) => categoryPath(root.name, child.name)));
}

/** Есть ли такой путь в дереве. */
export function hasCategoryPath(raw: string): boolean {
  const parsed = parseCategoryPath(raw);
  if (!parsed) return false;
  const root = SEED_CATEGORIES.find((r) => r.name === parsed.root);
  return root ? root.children.some((c) => c.name === parsed.child) : false;
}
