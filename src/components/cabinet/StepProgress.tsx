/* Прогресс формы выкладки. Это индикатор объёма работы, а не визард: блоки
 * заполняются в любом порядке, отрезки просто показывают, сколько уже собрано. */
export function StepProgress({
  title,
  done,
  total,
}: {
  title: string;
  done: number;
  total: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="font-display text-lg font-semibold">{title}</span>
      <div
        className="flex min-w-32 flex-1 items-center gap-2"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Заполнено блоков"
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-[3px] flex-1 rounded-sm ${i < done ? "bg-accent" : "bg-border"}`}
          />
        ))}
      </div>
      <span className="font-mono text-2xs uppercase tracking-mono text-muted-foreground">
        {done} из {total}
      </span>
    </div>
  );
}
