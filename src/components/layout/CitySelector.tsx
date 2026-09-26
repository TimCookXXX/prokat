"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { content } from "@theme/content";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export interface CityOption {
  slug: string;
  name: string;
}

export function CitySelector({
  cities,
  currentSlug,
  onDark = false,
}: {
  cities: CityOption[];
  currentSlug?: string;
  /** Стоит на бренд-цвете (шапка). */
  onDark?: boolean;
}) {
  const current = cities.find((c) => c.slug === currentSlug) ?? (cities.length === 1 ? cities[0] : undefined);
  const tone = onDark
    ? "border-white/25 text-header-foreground hover:bg-white/10"
    : "border-border text-foreground hover:bg-foreground/5";

  // Один город — выбирать не из чего: показываем название, не меню.
  if (cities.length <= 1) {
    return (
      <span className={cn("truncate text-sm", onDark ? "text-header-muted" : "text-muted-foreground")}>
        {current?.name ?? ""}
      </span>
    );
  }

  return (
    // modal={false}: без него Radix включает scroll-lock (overflow:hidden на
    // body), и страница под меню прыгает. См. тот же приём в UserMenu.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-9 min-w-0 items-center gap-1 rounded-pill border px-3 text-sm transition-colors",
          tone,
        )}
      >
        <span className="min-w-0 max-w-[8rem] truncate">{current?.name ?? content.nav.city}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {cities.map((c) => (
          <DropdownMenuItem key={c.slug} asChild>
            <Link href={`/${c.slug}` as never}>{c.name}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
