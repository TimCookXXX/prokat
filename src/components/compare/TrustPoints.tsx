import { Clock, ListFilter, Receipt, type LucideIcon } from "lucide-react";
import { content } from "@theme/content";

const ICONS: LucideIcon[] = [ListFilter, Clock, Receipt];

// Три пункта «почему цене можно верить» (макет HomeB).
export function TrustPoints() {
  return (
    <section aria-label="Почему цене можно верить" className="grid gap-5 md:grid-cols-3 md:gap-4">
      {content.home.trustItems.map((it, i) => {
        const Icon = ICONS[i] ?? Receipt;
        return (
          <div key={it.title} className="flex items-start gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-field bg-card">
              <Icon className="h-[22px] w-[22px] text-primary" aria-hidden="true" />
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-semibold">{it.title}</h3>
              <p className="text-sm leading-snug text-muted-foreground">{it.text}</p>
            </div>
          </div>
        );
      })}
    </section>
  );
}
