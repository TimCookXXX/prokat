import type { Metadata } from "next";
import { adminListRegularRequests } from "@/server/shops";
import { adminSetRegularRequestStatus } from "@/server/actions/shops";
import { ActionButton } from "@/components/admin/ActionButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Нужен регулярно — админка", robots: { index: false } };

const STATUS = { new: "новая", sent: "передали прокатам", closed: "закрыта" } as const;

// Заявки «берём регулярно» — проверка гипотезы о постоянных арендаторах.
export default async function AdminRegularPage() {
  const rows = await adminListRegularRequests();
  return (
    <section aria-label="Нужен регулярно">
      <p className="mb-4 text-sm text-muted-foreground">Заявок: {rows.length}. Передавайте прокатам и отмечайте статус.</p>
      <ul className="flex flex-col gap-2">
        {rows.map(({ req }) => (
          <li key={req.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium">
                {req.what}
                <span className="ml-2 rounded-pill bg-muted px-2 py-0.5 text-xs text-muted-foreground">{STATUS[req.status]}</span>
              </p>
              <p className="text-muted-foreground">
                {[req.kind === "not_found" ? "не нашли в выдаче" : "нужен регулярно", req.period, req.frequency, req.contact, req.createdAt.toLocaleDateString("ru-RU")].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex gap-2">
              {req.status !== "sent" && <ActionButton label="Передали" variant="ghost" action={adminSetRegularRequestStatus.bind(null, req.id, "sent")} />}
              {req.status !== "closed" && <ActionButton label="Закрыть" variant="ghost" action={adminSetRegularRequestStatus.bind(null, req.id, "closed")} />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
