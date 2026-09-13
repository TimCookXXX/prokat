/* Число с подписью: «6 вещей», «11 аренд». Рейтинга в модели нет, поэтому
 * метрики — то, что происходит на самом деле. Используется в полосе кабинета
 * и в визитке публичного профиля, чтобы одно и то же число там и там выглядело
 * одинаково. */
export function Metric({
  value,
  label,
  accent = false,
}: {
  value: number;
  label: string;
  /** Охра для того, что требует действия: «3 ждут ответа». */
  accent?: boolean;
}) {
  return (
    <div>
      <div className={`font-mark text-[22px] font-bold leading-tight ${accent ? "text-accent" : ""}`}>
        {value}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
