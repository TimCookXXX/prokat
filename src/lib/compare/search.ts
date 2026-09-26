// Поиск «Что нужно»: подсказки по мере набора, как у маркетплейсов.
// «перфо» → перфоратор и его классы; «перфо maki» → Makita среди перфораторов;
// «2470» → модель. Прощает раскладку («gthajhfnjh»), транслит («perforator»,
// «макита») и одну опечатку. Чистые функции: индекс строится из каталога города,
// поиск идёт на клиенте без запросов к серверу.

import { ruPlural } from "@/lib/plural";

export interface SearchGroupInput {
  slug: string;
  name: string;
  nameGenitive: string;
  category: string;
  keywords: string[];
  /** Прокатов с ценами в городе. */
  shops: number;
  fromPrice: { rub: number; per: "day" | "week" } | null;
  classes: { slug: string; name: string; shortHint: string | null }[];
}

export interface SearchModelInput {
  groupSlug: string;
  classSlug: string;
  model: string;
  shops: number;
  /** Самая низкая суточная цена модели (только свежие цены). */
  fromDay: number | null;
}

export type SuggestionKind = "group" | "class" | "brand" | "model";

export interface Suggestion {
  key: string;
  kind: SuggestionKind;
  title: string;
  subtitle: string;
  groupSlug: string;
  classSlug: string;
  /** Фильтр выдачи по модели или бренду (параметр `m`); null — все модели. */
  model: string | null;
}

export interface SearchEntry {
  suggestion: Suggestion;
  /** Слова самой подсказки: имя группы, класса, модели. */
  own: string[];
  /** Слова контекста: группа и синонимы для класса, класс для модели. */
  context: string[];
  shops: number;
}

/** Как ещё пишут бренды по-русски (то, что не сводится транслитом). */
export const BRAND_ALIASES: Record<string, string[]> = {
  dewalt: ["деволт", "девольт", "девалт"],
  bosch: ["бош"],
  karcher: ["керхер", "кархер"],
  hilti: ["хилти"],
};

// ------------------------------------------------------------ нормализация

export function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();
}

function words(...parts: (string | null | undefined)[]): string[] {
  return parts.flatMap((p) => (p ? normalize(p).split(" ").filter(Boolean) : []));
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

const brandOf = (model: string) => model.trim().split(/\s+/)[0] ?? "";

function brandWords(brand: string): string[] {
  const key = normalize(brand);
  return [key, ...(BRAND_ALIASES[key] ?? [])];
}

/** Модель слитно — «GBH 2-26» ищется и как «gbh226». */
function compact(s: string): string {
  return normalize(s).replace(/ /g, "");
}

function rub(n: number): string {
  return `${n.toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;
}

function shopsText(n: number): string {
  return `${n} ${ruPlural(n, "прокат", "проката", "прокатов")}`;
}

export function buildSearchIndex(groups: SearchGroupInput[], models: SearchModelInput[]): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const g of groups) {
    const groupWords = words(g.name, g.nameGenitive, ...g.keywords);
    const price = g.fromPrice ? `от ${rub(g.fromPrice.rub)} ${g.fromPrice.per === "day" ? "в сутки" : "в неделю"}` : "цены собираем";
    out.push({
      suggestion: {
        key: `g:${g.slug}`,
        kind: "group",
        title: g.name,
        subtitle: g.shops > 0 ? `${g.category} · ${shopsText(g.shops)} · ${price}` : `${g.category} · ${price}`,
        groupSlug: g.slug,
        classSlug: g.classes[0]?.slug ?? "",
        model: null,
      },
      own: [...groupWords, ...words(g.category)],
      context: [],
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
            groupSlug: g.slug,
            classSlug: c.slug,
            model: null,
          },
          own: words(c.name),
          context: [...groupWords, ...words(c.shortHint)],
          shops: g.shops,
        });
      }
    }
  }

  const groupBySlug = new Map(groups.map((g) => [g.slug, g]));
  const byClassBrand = new Map<string, SearchModelInput[]>();
  for (const m of models) {
    const k = `${m.classSlug}|${normalize(brandOf(m.model))}`;
    byClassBrand.set(k, [...(byClassBrand.get(k) ?? []), m]);
  }

  for (const list of byClassBrand.values()) {
    const first = list[0];
    const g = groupBySlug.get(first.groupSlug);
    const c = g?.classes.find((x) => x.slug === first.classSlug);
    if (!g || !c) continue;
    const brand = brandOf(first.model);
    const context = [...words(c.name), ...words(g.name, g.nameGenitive, ...g.keywords)];

    // Бренд — когда у него в классе несколько моделей: «Перфоратор SDS-plus Makita».
    if (list.length > 1) {
      const shops = list.reduce((s, m) => s + m.shops, 0);
      out.push({
        suggestion: {
          key: `b:${c.slug}:${normalize(brand)}`,
          kind: "brand",
          title: `${c.name} ${brand}`,
          subtitle: `${list.length} ${ruPlural(list.length, "модель", "модели", "моделей")} · ${shopsText(shops)}`,
          groupSlug: g.slug,
          classSlug: c.slug,
          model: brand,
        },
        own: brandWords(brand),
        context,
        shops,
      });
    }
    for (const m of list) {
      const rest = m.model.trim().slice(brand.length);
      out.push({
        suggestion: {
          key: `m:${c.slug}:${normalize(m.model)}`,
          kind: "model",
          title: m.model,
          subtitle: `${c.name} · ${shopsText(m.shops)}${m.fromDay != null ? ` · от ${rub(m.fromDay)} в сутки` : ""}`,
          groupSlug: g.slug,
          classSlug: c.slug,
          model: m.model,
        },
        own: [...brandWords(brand), ...words(rest), compact(rest)].filter(Boolean),
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

/** Насколько слово запроса совпадает со словом подсказки; 0 — не совпадает. */
function wordScore(t: string, w: string): number {
  if (w === t) return 3;
  if (w.startsWith(t)) return 2 + 0.5 * (t.length / w.length);
  if (t.length >= 3 && w.includes(t)) return 1;
  if (t.length >= 4) {
    const max = t.length >= 7 ? 2 : 1;
    // Опечатка в начале слова: сравниваем с префиксом той же длины (±1).
    for (let len = t.length - 1; len <= t.length + 1; len++) {
      if (len > w.length) break;
      if (editDistance(t, w.slice(0, len), max) <= max) return 0.8;
    }
  }
  return 0;
}

const best = (t: string, list: string[]) => list.reduce((m, w) => Math.max(m, wordScore(t, w)), 0);

/** Варианты слова запроса: как есть, в другой раскладке, транслитом. Каждый — одно или несколько слов. */
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
  add(switchLayout(raw), CONVERTED_WEIGHT);
  const n = normalize(raw);
  if (n && !n.includes(" ")) add(transliterate(n), CONVERTED_WEIGHT);
  return forms;
}

interface TokenMatch { score: number; own: boolean }

function matchToken(forms: ReturnType<typeof tokenForms>, e: SearchEntry): TokenMatch | null {
  let result: TokenMatch | null = null;
  for (const f of forms) {
    let sum = 0;
    let own = true;
    let ok = true;
    for (const part of f.parts) {
      const o = best(part, e.own);
      const c = best(part, e.context) * CONTEXT_WEIGHT;
      if (o === 0 && c === 0) { ok = false; break; }
      if (o < c) own = false;
      sum += Math.max(o, c);
    }
    if (!ok) continue;
    const score = (sum / f.parts.length) * f.weight;
    if (!result || score > result.score) result = { score, own };
  }
  return result;
}

/** Подсказки по запросу; пустой запрос — популярные группы. */
export function searchSuggestions(index: SearchEntry[], query: string, limit = 8): Suggestion[] {
  const tokens = query.split(/\s+/).filter((t) => normalize(t));
  if (tokens.length === 0) return popularSuggestions(index, limit);
  const forms = tokens.map(tokenForms);

  const scored: { e: SearchEntry; score: number; i: number }[] = [];
  for (const [i, e] of index.entries()) {
    let sum = 0;
    let anyOwn = false;
    let ok = true;
    for (const f of forms) {
      const m = matchToken(f, e);
      if (!m) { ok = false; break; }
      sum += m.score;
      anyOwn ||= m.own;
    }
    // Хоть одно слово должно попасть в саму подсказку: «перфо» не выводит все модели перфораторов.
    if (!ok || !anyOwn) continue;
    const score = sum / forms.length
      + KIND_BONUS[e.suggestion.kind]
      + Math.min(e.shops, 20) * 0.01
      - (e.shops === 0 ? 0.3 : 0);
    scored.push({ e, score, i });
  }
  // При равенстве — порядок справочника: SDS-plus раньше SDS-max.
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.e.suggestion);
}

export function popularSuggestions(index: SearchEntry[], limit = 8): Suggestion[] {
  return index
    .filter((e) => e.suggestion.kind === "group" && e.shops > 0)
    .sort((a, b) => b.shops - a.shops)
    .slice(0, limit)
    .map((e) => e.suggestion);
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

/** Предложение подходит под фильтр `m`: точная модель или все модели бренда. */
export function modelMatches(filter: string | null): (model: string | null | undefined) => boolean {
  const f = filter ? normalize(filter) : "";
  if (!f) return () => true;
  return (model) => {
    const m = model ? normalize(model) : "";
    return m === f || m.startsWith(`${f} `);
  };
}
