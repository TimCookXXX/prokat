// Поиск «Что нужно» (ТЗ, п. 3.1): подсказки по мере набора и разбор запроса,
// набранного без выбора подсказки. Уровни запроса по порядку:
//   1. модель        «Puzzi 8/1», «HR2470»          → предложения модели
//   2. бренд + класс «макита перфоратор»            → модели бренда в классе
//   3. класс         «перфоратор», «моющий пылесос» → все предложения класса
//   4. неоднозначно  «пылесос»                      → чипы «Моющий / Строительный»
//   5. не найдено                                   → похожие классы и заявка
// Регистр, пробелы, дефисы и косые черты не важны; кириллица и латиница
// взаимозаменяемы (и похожие буквы в артикулах); неверная раскладка; до двух
// опечаток; падежи и число; синонимы классов, брендов и написания моделей.
// Чистые функции: индекс строится из каталога города, работает и на клиенте
// (подсказки), и на сервере (разбор запроса).

import { ruPlural } from "@/lib/plural";
import { fixHomoglyphs } from "@/lib/compare/models";

export interface SearchClassInput {
  slug: string;
  name: string;
  shortHint: string | null;
  keywords?: string[];
  /** Уточнение для чипов при неоднозначном запросе: «Моющий». */
  chip?: string | null;
}

export interface SearchGroupInput {
  slug: string;
  name: string;
  nameGenitive: string;
  category: string;
  keywords: string[];
  /** Прокатов с ценами в городе. */
  shops: number;
  fromPrice: { rub: number; per: "day" | "week" } | null;
  classes: SearchClassInput[];
}

export interface SearchBrandInput {
  slug: string;
  name: string;
  aliases: string[];
}

export interface SearchModelInput {
  slug: string;
  brand: string;
  /** Без бренда: «HR2470». */
  name: string;
  family: string | null;
  aliases: string[];
  groupSlug: string;
  classSlug: string;
  /** Прокатов с этой моделью в городе. */
  shops: number;
  /** Самая низкая суточная цена модели (только свежие цены). */
  fromDay: number | null;
}

export interface SearchData {
  groups: SearchGroupInput[];
  brands: SearchBrandInput[];
  models: SearchModelInput[];
}

/** Куда ведёт выбор: страница группы (с классом, брендом, моделями) или модели. */
export interface SearchTarget {
  groupSlug: string;
  classSlug?: string;
  brandSlug?: string;
  /** Одна модель — страница модели; несколько — фильтр на странице группы. */
  modelSlugs?: string[];
}

export type SuggestionKind = "group" | "class" | "brand" | "model";

export interface Suggestion {
  key: string;
  kind: SuggestionKind;
  title: string;
  subtitle: string;
  target: SearchTarget;
}

export interface SearchEntry {
  suggestion: Suggestion;
  /** Слова самой подсказки: имя группы, класса, модели. */
  own: string[];
  /** Слова артикула модели (без бренда) — отличают «модель» от «бренда». */
  article: string[];
  /** Слова контекста: группа и синонимы для класса, класс для модели. */
  context: string[];
  shops: number;
}

// ------------------------------------------------------------ нормализация

export function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();
}

function words(...parts: (string | null | undefined)[]): string[] {
  return parts.flatMap((p) => (p ? normalize(p).split(" ").filter(Boolean) : []));
}

/** Слитно — «GBH 2-26» ищется и как «gbh226», «Puzzi 8/1» — как «puzzi81». */
function compact(s: string): string {
  return normalize(s).replace(/ /g, "");
}

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = "йцукенгшщзхъфывапролджэячсмитьбюё";
const EN_TO_RU = new Map([...EN].map((c, i) => [c, RU[i]]));
const RU_TO_EN = new Map([...RU].map((c, i) => [c, EN[i]]));

/** Набрано не в той раскладке: «gthajhfnjh» → «перфоратор», «ьфлшеф» → «makita». */
export function switchLayout(s: string): string {
  const low = s.toLowerCase();
  const map = /[a-z]/.test(low) ? EN_TO_RU : RU_TO_EN;
  return [...low].map((c) => map.get(c) ?? c).join("");
}

const LAT_TO_CYR: [string, string][] = [
  ["shch", "щ"], ["sch", "щ"], ["zh", "ж"], ["ch", "ч"], ["sh", "ш"], ["kh", "х"], ["ts", "ц"],
  ["ya", "я"], ["yu", "ю"], ["yo", "е"], ["a", "а"], ["b", "б"], ["v", "в"], ["g", "г"], ["d", "д"],
  ["e", "е"], ["z", "з"], ["i", "и"], ["y", "ы"], ["k", "к"], ["l", "л"], ["m", "м"], ["n", "н"],
  ["o", "о"], ["p", "п"], ["r", "р"], ["s", "с"], ["t", "т"], ["u", "у"], ["f", "ф"], ["h", "х"],
  ["c", "к"], ["w", "в"], ["x", "кс"], ["j", "дж"], ["q", "к"],
];
const CYR_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch",
  ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Транслит в обе стороны: «perforator» → «перфоратор», «макита» → «makita». */
export function transliterate(word: string): string {
  if (/[а-я]/.test(word)) return [...word].map((c) => CYR_TO_LAT[c] ?? c).join("");
  let out = "";
  for (let i = 0; i < word.length;) {
    const hit = LAT_TO_CYR.find(([lat]) => word.startsWith(lat, i));
    if (hit) { out += hit[1]; i += hit[0].length; } else { out += word[i]; i++; }
  }
  return out;
}

// Окончания для грубой основы: «перфоратора», «перфораторы», «моющего», «болгарку».
const ENDINGS = [
  "ами", "ями", "ого", "его", "ому", "ему", "ыми", "ими", "ах", "ях", "ов", "ев", "ей", "ой", "ый", "ий",
  "ая", "яя", "ое", "ее", "ую", "юю", "ом", "ем", "ам", "ям", "а", "я", "ы", "и", "у", "ю", "е", "о",
];

/** Основа русского слова: окончание прочь, если остаётся не меньше 4 букв. */
export function stem(t: string): string {
  if (!/[а-я]/.test(t) || t.length < 5) return t;
  for (const e of ENDINGS) if (t.endsWith(e) && t.length - e.length >= 4) return t.slice(0, -e.length);
  return t;
}

/** Расстояние с перестановкой соседних букв (OSA), с отсечкой по max. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

// ------------------------------------------------------------------ индекс

function rub(n: number): string {
  return `${n.toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;
}

function shopsText(n: number): string {
  return `${n} ${ruPlural(n, "прокат", "проката", "прокатов")}`;
}

function spellingWords(s: string): string[] {
  return [...words(s), compact(s)].filter(Boolean);
}

export function buildSearchIndex({ groups, brands, models }: SearchData): SearchEntry[] {
  const out: SearchEntry[] = [];
  const brandBySlug = new Map(brands.map((b) => [b.slug, b]));
  const brandWordsOf = (slug: string) => {
    const b = brandBySlug.get(slug);
    return b ? [b.name, ...b.aliases].flatMap((n) => spellingWords(n)) : [];
  };

  for (const g of groups) {
    const groupWords = words(g.name, g.nameGenitive, ...g.keywords);
    const price = g.fromPrice ? `от ${rub(g.fromPrice.rub)} ${g.fromPrice.per === "day" ? "в сутки" : "в неделю"}` : "цены собираем";
    out.push({
      suggestion: {
        key: `g:${g.slug}`,
        kind: "group",
        title: g.name,
        subtitle: g.shops > 0 ? `${g.category} · ${shopsText(g.shops)} · ${price}` : `${g.category} · ${price}`,
        target: { groupSlug: g.slug },
      },
      own: groupWords,
      article: [],
      context: words(g.category),
      shops: g.shops,
    });
    // Одноклассовая группа (штроборез, модель велосипеда) — класс дублировал бы группу.
    if (g.classes.length > 1) {
      for (const c of g.classes) {
        out.push({
          suggestion: {
            key: `c:${c.slug}`,
            kind: "class",
            title: c.name,
            subtitle: c.shortHint ?? g.name,
            target: { groupSlug: g.slug, classSlug: c.slug },
          },
          own: words(c.name, c.chip, ...(c.keywords ?? [])),
          article: [],
          context: [...groupWords, ...words(c.shortHint)],
          shops: g.shops,
        });
      }
    }
  }

  const groupBySlug = new Map(groups.map((g) => [g.slug, g]));
  const byClassBrand = new Map<string, SearchModelInput[]>();
  for (const m of models) {
    const k = `${m.classSlug}|${m.brand}`;
    byClassBrand.set(k, [...(byClassBrand.get(k) ?? []), m]);
  }

  for (const list of byClassBrand.values()) {
    const first = list[0];
    const g = groupBySlug.get(first.groupSlug);
    const c = g?.classes.find((x) => x.slug === first.classSlug);
    const brand = brandBySlug.get(first.brand);
    if (!g || !c || !brand) continue;
    const context = [...words(c.name, c.chip, ...(c.keywords ?? [])), ...words(g.name, g.nameGenitive, ...g.keywords)];
    const brandWords = brandWordsOf(brand.slug);
    const withOffers = list.filter((m) => m.shops > 0);

    // Бренд в классе — когда у него здесь несколько моделей с ценами: «Перфоратор SDS-plus Makita».
    if (withOffers.length > 1) {
      const shops = withOffers.reduce((s, m) => s + m.shops, 0);
      out.push({
        suggestion: {
          key: `b:${c.slug}:${brand.slug}`,
          kind: "brand",
          title: `${c.name} ${brand.name}`,
          subtitle: `${withOffers.length} ${ruPlural(withOffers.length, "модель", "модели", "моделей")} · ${shopsText(shops)}`,
          target: { groupSlug: g.slug, classSlug: c.slug, brandSlug: brand.slug },
        },
        own: brandWords,
        article: [],
        context,
        shops,
      });
    }
    for (const m of list) {
      const article = [m.name, m.family, ...m.aliases].filter((s): s is string => !!s).flatMap(spellingWords);
      const price = m.fromDay != null ? ` · от ${rub(m.fromDay)} в сутки` : "";
      out.push({
        suggestion: {
          key: `m:${m.slug}`,
          kind: "model",
          title: `${brand.name} ${m.name}`,
          subtitle: m.shops > 0 ? `${c.name} · ${shopsText(m.shops)}${price}` : `${c.name} · цены собираем`,
          target: { groupSlug: g.slug, classSlug: c.slug, modelSlugs: [m.slug] },
        },
        own: [...brandWords, ...article],
        article,
        context,
        shops: m.shops,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------- поиск

const KIND_BONUS: Record<SuggestionKind, number> = { group: 0.3, class: 0.2, brand: 0.15, model: 0.1 };
const CONTEXT_WEIGHT = 0.6;
const CONVERTED_WEIGHT = 0.95;
const FUZZY = 0.8;

/**
 * Насколько слово запроса совпадает со словом подсказки; 0 — не совпадает.
 * `strict` — для раскладки и транслита: опечатка только против слова целиком,
 * иначе «max» → «макс» ≈ «макита», а «бензорез» ≈ «бензогенератор».
 */
function wordScore(t: string, w: string, strict = false): number {
  if (w === t) return 3;
  if (w.startsWith(t)) return 2 + 0.5 * (t.length / w.length);
  // Падеж и число: «перфоратора», «перфораторы», «моющего».
  const s = stem(t);
  if (s !== t && w.startsWith(s)) return 1.9;
  if (t.length >= 3 && w.includes(t)) return 1;
  if (t.length >= 4) {
    // Опечатки: против слова целиком (±1 буква) — до двух в длинном, одна в коротком;
    // против начала длинного слова (человек ещё печатает) — только одна.
    for (let len = t.length - 1; len <= t.length + 1; len++) {
      if (len > w.length) break;
      const whole = len >= w.length - 1;
      const max = whole ? (!strict && t.length >= 6 ? 2 : 1) : strict ? -1 : 1;
      if (max >= 0 && editDistance(t, w.slice(0, len), max) <= max) return FUZZY;
    }
  }
  return 0;
}

const best = (t: string, list: string[], strict = false) => list.reduce((m, w) => Math.max(m, wordScore(t, w, strict)), 0);

/** Слова запроса, которые не про вещь: «прокат перфоратора в Краснодаре на выходные». */
const QUERY_STOP_WORDS = new Set([
  "прокат", "проката", "прокате", "напрокат", "аренда", "аренды", "аренду", "арендовать", "взять", "снять",
  "купить", "недорого", "дешево", "цена", "цены", "стоимость", "сколько", "стоит",
  "в", "во", "на", "для", "до", "с", "со", "от", "и", "по", "за", "без",
  "краснодар", "краснодаре", "краснодара", "сутки", "день", "неделю", "выходные",
]);

/** Слова запроса без служебных; одни служебные — оставляем как есть. */
function queryTokens(query: string): string[] {
  const all = query.split(/\s+/).filter((t) => normalize(t));
  const meaningful = all.filter((t) => !QUERY_STOP_WORDS.has(normalize(t)));
  return meaningful.length ? meaningful : all;
}

/** Варианты слова запроса: как есть, похожие буквы, раскладка, транслит, раскладка + транслит. */
function tokenForms(raw: string): { parts: string[]; weight: number }[] {
  const seen = new Set<string>();
  const forms: { parts: string[]; weight: number }[] = [];
  const add = (s: string, weight: number) => {
    const n = normalize(s);
    if (!n || seen.has(n)) return;
    seen.add(n);
    forms.push({ parts: n.split(" "), weight });
  };
  add(raw, 1);
  add(fixHomoglyphs(raw), 1);
  const layout = switchLayout(raw);
  add(layout, CONVERTED_WEIGHT);
  for (const s of [raw, layout]) {
    const n = normalize(s);
    if (n && !n.includes(" ")) add(transliterate(n), CONVERTED_WEIGHT);
  }
  // Артикул слитно: «puzzi8/1» ищем и как «puzzi81».
  const joined = compact(raw);
  if (/\d/.test(joined)) add(joined, 1);
  return forms;
}

interface TokenMatch { score: number; own: boolean; article: boolean }

function matchToken(forms: ReturnType<typeof tokenForms>, e: SearchEntry): TokenMatch | null {
  let result: TokenMatch | null = null;
  for (const f of forms) {
    let sum = 0;
    let own = true;
    let article = true;
    let ok = true;
    const strict = f.weight < 1;
    for (const part of f.parts) {
      const o = best(part, e.own, strict);
      const c = best(part, e.context, strict) * CONTEXT_WEIGHT;
      if (o === 0 && c === 0) { ok = false; break; }
      if (o < c) own = false;
      // Буква «с» — не артикул «Puzzi 8/1 C»: модель узнаём по словам от двух знаков.
      if (part.length < 2 || best(part, e.article, strict) === 0) article = false;
      sum += Math.max(o, c);
    }
    if (!ok) continue;
    const score = (sum / f.parts.length) * f.weight;
    if (!result || score > result.score) result = { score, own, article };
  }
  return result;
}

interface Scored { e: SearchEntry; score: number; i: number; articleHit: boolean }

/** Подсказки, где совпали все слова запроса (кроме служебных), по убыванию оценки. */
function scoreAll(index: SearchEntry[], query: string): Scored[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  const forms = tokens.map(tokenForms);
  const scored: Scored[] = [];
  for (const [i, e] of index.entries()) {
    let sum = 0;
    let anyOwn = false;
    let articleHit = false;
    let ok = true;
    for (const f of forms) {
      const m = matchToken(f, e);
      if (!m) { ok = false; break; }
      sum += m.score;
      anyOwn ||= m.own;
      articleHit ||= m.article;
    }
    // Хоть одно слово должно попасть в саму подсказку: «перфо» не выводит все модели перфораторов.
    if (!ok || !anyOwn) continue;
    const score = sum / forms.length
      + KIND_BONUS[e.suggestion.kind]
      + Math.min(e.shops, 20) * 0.01
      - (e.shops === 0 ? 0.3 : 0);
    scored.push({ e, score, i, articleHit });
  }
  // При равенстве — порядок справочника: SDS-plus раньше SDS-max.
  return scored.sort((a, b) => b.score - a.score || a.i - b.i);
}

export interface SuggestionLists {
  models: Suggestion[];
  classes: Suggestion[];
}

/** Подсказки под полем: модели и классы, по `limit` штук (ТЗ — по 5). Пусто — популярное. */
export function searchSuggestions(index: SearchEntry[], query: string, limit = 5): SuggestionLists {
  const scored = scoreAll(index, query);
  if (!normalize(query)) return { models: [], classes: popularSuggestions(index, limit) };
  return {
    models: scored.filter((s) => s.e.suggestion.kind === "model").slice(0, limit).map((s) => s.e.suggestion),
    classes: scored.filter((s) => s.e.suggestion.kind !== "model").slice(0, limit).map((s) => s.e.suggestion),
  };
}

export function popularSuggestions(index: SearchEntry[], limit = 6): Suggestion[] {
  return index
    .filter((e) => e.suggestion.kind === "group" && e.shops > 0)
    .sort((a, b) => b.shops - a.shops)
    .slice(0, limit)
    .map((e) => e.suggestion);
}

// ------------------------------------------------------------ разбор запроса

export interface Chip {
  label: string;
  target: SearchTarget;
}

export type Resolution =
  | { level: "model"; target: SearchTarget; title: string }
  | { level: "brand"; target: SearchTarget; title: string }
  | { level: "class"; target: SearchTarget; title: string }
  | { level: "ambiguous"; chips: Chip[] }
  | { level: "none"; similar: Suggestion[] };

/** Лучшие по оценке — в пределах `gap` от первого. */
function top(list: Scored[], gap = 0.45): Scored[] {
  return list.length ? list.filter((s) => s.score >= list[0].score - gap) : [];
}

const groupName = (data: SearchData, slug: string) => data.groups.find((g) => g.slug === slug)?.name ?? slug;

/**
 * Разбор запроса, набранного без выбора подсказки (ТЗ, п. 3.1): модель → бренд
 * и класс → класс → неоднозначное слово → не найдено. Если все слова вместе не
 * сходятся («генератор 5 квт», «строительные леса»), разбираем самую удачную
 * часть запроса — лучше страница класса, чем «не нашли».
 */
export function resolveQuery(index: SearchEntry[], query: string, data: SearchData): Resolution {
  // Одна буква («с», «d») — не запрос: иначе она «находит» случайный артикул.
  if (compact(query).length < 2) return { level: "none", similar: popularSuggestions(index, 5) };
  const full = resolveExact(index, query, data);
  if (full.level !== "none") return full;

  const tokens = queryTokens(query).slice(0, 6);
  for (let k = tokens.length - 1; k >= 1; k--) {
    let bestPart: { q: string; score: number } | null = null;
    for (const part of subsets(tokens, k)) {
      const q = part.join(" ");
      const hit = scoreAll(index, q)[0];
      if (hit && (!bestPart || hit.score > bestPart.score)) bestPart = { q, score: hit.score };
    }
    if (bestPart) {
      const r = resolveExact(index, bestPart.q, data);
      if (r.level !== "none") return r;
    }
  }
  return full;
}

function subsets<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items;
  return [...subsets(rest, k - 1).map((s) => [head, ...s]), ...subsets(rest, k)];
}

function resolveExact(index: SearchEntry[], query: string, data: SearchData): Resolution {
  const scored = scoreAll(index, query);
  if (!scored.length) return { level: "none", similar: similarSuggestions(index, query) };

  // 1. Модель: слово запроса попало в артикул («puzzi», «2470»), не только в бренд.
  const models = top(scored.filter((s) => s.e.suggestion.kind === "model" && s.articleHit));
  if (models.length) {
    const slugs = [...new Set(models.flatMap((s) => s.e.suggestion.target.modelSlugs ?? []))];
    const first = models[0].e.suggestion;
    if (slugs.length === 1) return { level: "model", target: first.target, title: first.title };
    // Несколько моделей: одного класса («puzzi» → 8/1 и 10/1) — класс с фильтром;
    // одной группы («hr» → SDS-plus и SDS-max) — группа с фильтром; разных — чипы.
    const byGroup = new Map<string, Scored[]>();
    for (const s of models) {
      const g = s.e.suggestion.target.groupSlug;
      byGroup.set(g, [...(byGroup.get(g) ?? []), s]);
    }
    if (byGroup.size === 1) {
      const sameClass = models.every((s) => s.e.suggestion.target.classSlug === first.target.classSlug);
      const target: SearchTarget = sameClass
        ? { ...first.target, modelSlugs: slugs }
        : { groupSlug: first.target.groupSlug, modelSlugs: slugs };
      return { level: "model", target, title: first.title };
    }
    return {
      level: "ambiguous",
      chips: [...byGroup].map(([groupSlug, list]) => ({
        label: groupName(data, groupSlug),
        target: { groupSlug, modelSlugs: [...new Set(list.flatMap((s) => s.e.suggestion.target.modelSlugs ?? []))] },
      })),
    };
  }

  // 2. Бренд: «макита», «макита перфоратор» — модели бренда в классе или группе.
  const brand = matchedBrand(query, data.brands);
  if (brand) {
    const withBrand = data.models.filter((m) => m.brand === brand.slug);
    const rest = queryTokens(query).filter((t) => !isBrandWord(t, brand));
    const hits = rest.length
      ? new Set(scoreAll(index, rest.join(" ")).filter((s) => s.e.suggestion.kind !== "model")
        .flatMap((s) => [s.e.suggestion.target.classSlug ?? "", `g:${s.e.suggestion.target.groupSlug}`]))
      : null;
    // Остаток запроса ни во что не попал («макита что-то») — считаем, что искали бренд целиком.
    const classHits = hits && hits.size > 0 ? hits : null;
    const inScope = withBrand.filter((m) => !classHits || classHits.has(m.classSlug) || classHits.has(`g:${m.groupSlug}`));
    const groupSlugs = [...new Set(inScope.map((m) => m.groupSlug))];
    if (groupSlugs.length === 1) {
      const classSlugs = [...new Set(inScope.map((m) => m.classSlug))];
      const target: SearchTarget = { groupSlug: groupSlugs[0], brandSlug: brand.slug, ...(classSlugs.length === 1 ? { classSlug: classSlugs[0] } : {}) };
      return { level: "brand", target, title: `${groupName(data, groupSlugs[0])} ${brand.name}`.trim() };
    }
    if (groupSlugs.length > 1) {
      return {
        level: "ambiguous",
        chips: groupSlugs.map((slug) => ({ label: groupName(data, slug), target: { groupSlug: slug, brandSlug: brand.slug } })),
      };
    }
  }

  // 3–4. Класс или несколько: одна группа — её страница; несколько — чипы.
  const classes = top(scored.filter((s) => s.e.suggestion.kind === "group" || s.e.suggestion.kind === "class"));
  const groupSlugs = [...new Set(classes.map((s) => s.e.suggestion.target.groupSlug))];
  if (groupSlugs.length === 1) {
    const bestHit = classes[0].e.suggestion;
    return { level: "class", target: bestHit.target, title: bestHit.title };
  }
  if (groupSlugs.length > 1) {
    return {
      level: "ambiguous",
      chips: groupSlugs.map((slug) => {
        const g = data.groups.find((x) => x.slug === slug);
        const label = g?.classes.length === 1 ? g.classes[0].chip ?? g.name : g?.name ?? slug;
        return { label, target: { groupSlug: slug } };
      }),
    };
  }
  return { level: "none", similar: similarSuggestions(index, query) };
}

function isBrandWord(token: string, brand: SearchBrandInput): boolean {
  const forms = tokenForms(token).flatMap((f) => f.parts);
  const names = [brand.name, ...brand.aliases].flatMap((n) => spellingWords(n));
  return forms.some((f) => names.some((n) => wordScore(f, n) >= 2));
}

/** Бренд, если хоть одно слово запроса — его название (с опечаткой, раскладкой, по-русски). */
export function matchedBrand(query: string, brands: SearchBrandInput[]): SearchBrandInput | null {
  const tokens = query.split(/\s+/).filter((t) => normalize(t).length >= 3);
  for (const b of brands) if (tokens.some((t) => isBrandWord(t, b))) return b;
  return null;
}

/** Похожее, когда ничего не нашлось: группы, где совпало хоть одно слово; иначе популярное. */
export function similarSuggestions(index: SearchEntry[], query: string, limit = 5): Suggestion[] {
  const tokens = query.split(/\s+/).filter((t) => normalize(t).length >= 3);
  const hits = new Map<string, Scored>();
  for (const t of tokens) {
    for (const s of scoreAll(index, t)) {
      if (s.e.suggestion.kind === "model") continue;
      const prev = hits.get(s.e.suggestion.key);
      if (!prev || prev.score < s.score) hits.set(s.e.suggestion.key, s);
    }
  }
  const list = [...hits.values()].sort((a, b) => b.score - a.score).map((s) => s.e.suggestion);
  return (list.length ? list : popularSuggestions(index, limit)).slice(0, limit);
}

/** Куски заголовка с подсветкой начал слов, совпавших с запросом (с учётом раскладки и транслита). */
export function highlight(title: string, query: string): { text: string; hit: boolean }[] {
  const tokens = query.split(/\s+/).flatMap((t) => tokenForms(t).flatMap((f) => f.parts)).filter(Boolean);
  if (tokens.length === 0) return [{ text: title, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  const re = /[A-Za-zА-Яа-яЁё0-9]+|[^A-Za-zА-Яа-яЁё0-9]+/g;
  for (const [piece] of title.matchAll(re)) {
    const n = normalize(piece);
    const t = n ? tokens.filter((x) => n.startsWith(x)).sort((a, b) => b.length - a.length)[0] : undefined;
    if (t) {
      out.push({ text: piece.slice(0, t.length), hit: true });
      if (piece.length > t.length) out.push({ text: piece.slice(t.length), hit: false });
    } else {
      out.push({ text: piece, hit: false });
    }
  }
  return out;
}
