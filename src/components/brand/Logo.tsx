import { cn } from "@/lib/utils";

/* Знак inrenta (вариант Б): слово Unbounded 700 и точка. Точка — единственный
 * яркий оранжевый: на тёмной шапке --color-cta-bright, на светлом фоне
 * --color-mark-dot (у яркого на белом не хватает контраста). */
export function Logo({
  size = 20,
  word = "inrenta",
  onDark = false,
  className,
}: {
  size?: number;
  word?: string;
  /** Знак стоит на бренд-цвете (шапка). */
  onDark?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-baseline font-display font-bold leading-none", className)}
      style={{ fontSize: size, letterSpacing: "-0.01em" }}
      aria-label={word}
    >
      <span aria-hidden="true">{word}</span>
      <span aria-hidden="true" className={onDark ? "text-cta-bright" : "text-mark-dot"}>.</span>
    </span>
  );
}
