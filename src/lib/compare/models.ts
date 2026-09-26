// Нормализация названия модели (ТЗ, п. 8.2): одно и то же изделие у разных прокатов
// пишется по-разному — «Makita HR 2470», «НR2470» (кириллическая Н), «перфоратор
// макита hr2470ft». Ключ сводит их к одной строке, по ней model_aliases находит модель.

/** Кириллица, которую путают с латиницей в артикулах. */
const HOMOGLYPHS: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y",
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", х: "x", у: "y",
};

/** В слове есть латиница — кириллические двойники в нём тоже латиница: «НR2470» → «HR2470». */
export function fixHomoglyphs(word: string): string {
  if (!/[A-Za-z]/.test(word)) return word;
  return [...word].map((c) => HOMOGLYPHS[c] ?? c).join("");
}

/** Слово без знаков: нижний регистр, ё → е, только буквы и цифры. */
export function compactWord(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, "");
}

/** Служебные слова, которые не часть названия модели. Классы добавляются вызывающим. */
export const SERVICE_WORDS = ["аренда", "аренды", "прокат", "проката", "модель", "новый", "б/у", "бу"];

export interface ModelKeyOptions {
  /** Бренды и их написания, уже через compactWord. */
  brandWords: ReadonlySet<string>;
  /** Слова классов и служебные слова, уже через compactWord. */
  stopWords: ReadonlySet<string>;
}

/**
 * Ключ написания модели: регистр, пробелы, дефисы, точки и косые черты не важны;
 * служебные слова убираются; бренд убирается, если есть артикул (слово с цифрой).
 * «Перфоратор Makita HR-2470 FT» → «hr2470ft», «Karcher Puzzi 8/1 C» → «puzzi81c».
 */
export function modelKey(raw: string, { brandWords, stopWords }: ModelKeyOptions): string {
  const words = raw.split(/\s+/).map((w) => compactWord(fixHomoglyphs(w))).filter(Boolean);
  const meaningful = words.filter((w) => !stopWords.has(w));
  const hasArticle = meaningful.some((w) => /\d/.test(w));
  return (hasArticle ? meaningful.filter((w) => !brandWords.has(w)) : meaningful).join("");
}

/** Все ключи, по которым находится модель: имя, семейство, варианты — с брендом и без. */
export function modelAliasKeys(
  m: { name: string; family?: string | null; aliases?: string[] },
  brand: { name: string; aliases: string[] },
  opts: ModelKeyOptions,
): string[] {
  const spellings = [m.name, m.family, ...(m.aliases ?? [])].filter((s): s is string => !!s);
  const brandNames = [brand.name, ...brand.aliases];
  const keys = new Set<string>();
  for (const s of spellings) {
    keys.add(modelKey(s, opts));
    for (const b of brandNames) keys.add(modelKey(`${b} ${s}`, opts));
  }
  keys.delete("");
  return [...keys];
}

export function brandWordSet(brands: { name: string; aliases: string[] }[]): Set<string> {
  return new Set(brands.flatMap((b) => [b.name, ...b.aliases]).map(compactWord).filter(Boolean));
}

/** Стоп-слова из названий классов: «перфоратор», «моющий». Числа и короткие слова
 * («125», «мм», «до») не трогаем — они бывают частью артикула. */
export function stopWordSet(classWords: string[]): Set<string> {
  const fromClasses = classWords.flatMap((s) => s.split(/\s+/)).map(compactWord)
    .filter((w) => w.length >= 3 && !/\d/.test(w));
  return new Set([...SERVICE_WORDS.map(compactWord), ...fromClasses].filter(Boolean));
}

/**
 * Ключ уникальности модели у предложения внутри (прокат, класс): модель из
 * справочника — «m:<id>», нераспознанное написание — «r:<ключ>», не указана — «».
 */
export function offerModelKey(modelId: string | null, rawKey: string | null): string {
  if (modelId) return `m:${modelId}`;
  return rawKey ? `r:${rawKey}` : "";
}
