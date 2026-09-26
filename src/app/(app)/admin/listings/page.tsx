import type { Metadata } from "next";
import Link from "next/link";
import { adminListListings } from "@/server/admin";
import { adminSetListingStatus } from "@/server/actions/admin";
import { ActionButton } from "@/components/admin/ActionButton";
import { formatPrice } from "@/lib/catalog/format";
import { listingPath } from "@/lib/catalog/listing-path";
import { requireP2P } from "@/lib/features";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Объявления — админка", robots: { index: false } };

const STATUS_LABEL: Record<string, string> = {
  active: "активно",
  hidden: "скрыто",
  archived: "архив",
};

export default async function AdminListingsPage() {
  requireP2P();
  const rows = await adminListListings();

  return (
    <section aria-label="Объявления">
      <p className="mb-4 text-sm text-muted-foreground">Последние {rows.length} объявлений</p>
      <ul className="flex flex-col gap-2">
        {rows.map(({ listing, ownerName, ownerUsername, citySlug, categorySlug }) => (
          <li key={listing.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
            <div className="min-w-0">
              <Link
                href={listingPath(citySlug, categorySlug, listing.slug, listing.id) as never}
                className="font-medium hover:underline underline-offset-2"
              >
                {listing.title}
              </Link>
              <p className="text-sm text-muted-foreground">
                {ownerName ?? `@${ownerUsername ?? "—"}`}
                {listing.priceDay !== null ? ` · ${formatPrice(listing.priceDay)}/сутки` : ""}
                {" · "}{STATUS_LABEL[listing.status] ?? listing.status}
              </p>
            </div>
            <div className="flex gap-2">
              {listing.status !== "active" && (
                <ActionButton label="Активировать" action={adminSetListingStatus.bind(null, listing.id, "active")} />
              )}
              {listing.status === "active" && (
                <ActionButton
                  label="Скрыть"
                  confirmText="Скрыть объявление из каталога?"
                  action={adminSetListingStatus.bind(null, listing.id, "hidden")}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
