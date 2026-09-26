import type { FaqItem } from "@/lib/compare/faq";

// Свой текст страницы: как выбрать класс и ответы из фактических цен.
export function CompareFaq({ items, guide, title }: { items: FaqItem[]; guide?: string | null; title: string }) {
  return (
    <section aria-labelledby="faq-title" className="mt-4 flex flex-col gap-4">
      <h2 id="faq-title" className="font-display text-xl font-semibold md:text-[22px]">{title}: вопросы и ответы</h2>
      {guide && (
        <div className="rounded-lg bg-card p-5 shadow-card">
          <h3 className="mb-1 text-base font-semibold">Как выбрать</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{guide}</p>
        </div>
      )}
      <div className="divide-y divide-border rounded-lg bg-card shadow-card">
        {items.map((it) => (
          <details key={it.q} className="group p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold">
              {it.q}
              <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{it.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
