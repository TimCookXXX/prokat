import { Calculator, CalendarCheck, Phone, Leaf, type LucideIcon } from "lucide-react";
import { content } from "@theme/content";

// Иконки к пунктам whyItems — в том же порядке.
const ICONS: LucideIcon[] = [Calculator, CalendarCheck, Phone];

export function WhyChoose() {
  return (
    <section aria-label={content.home.whyHeading}>
      <h2 className="mb-12 text-center text-2xl font-bold text-foreground sm:text-3xl">
        {content.home.whyHeading}
      </h2>
      <div className="grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
        {content.home.whyItems.map((item, i) => {
          const Icon = ICONS[i] ?? Leaf;
          return (
            <div key={item.title} className="flex flex-col items-center text-center">
              <span className="flex h-24 w-24 items-center justify-center rounded-full bg-accent text-white shadow-[0_10px_30px_-8px] shadow-accent/40">
                <Icon className="h-10 w-10" aria-hidden="true" strokeWidth={1.75} />
              </span>
              <h3 className="mt-5 text-xl font-bold text-foreground">{item.title}</h3>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">{item.text}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
