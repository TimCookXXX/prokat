import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAuthState } from "@/lib/auth/guard";
import { getUserProfile } from "@/server/me";
import { ProfileForm } from "@/components/me/ProfileForm";
import { isP2PEnabled } from "@/lib/features";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Профиль", robots: { index: false } };

// Человекочитаемые названия провайдеров входа (accounts.provider).
const PROVIDER_LABELS: Record<string, string> = {
  yandex: "Яндекс ID",
  vkid: "ВКонтакте",
  mail_ru: "Мой Мир@mail.ru",
  ok_ru: "Одноклассники",
};

export default async function ProfilePage() {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/profile");

  const profile = await getUserProfile(session.user.id);
  if (!profile) redirect("/login");
  const { user, providers } = profile;

  return (
    <section aria-label="Профиль" className="flex flex-col gap-5">
      <div className="surface p-5 sm:p-6">
        <h2 className="mb-3 text-lg font-semibold">Данные</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          @{user.username} · {user.email}
        </p>
        <ProfileForm initialName={user.name ?? ""} initialPhone={user.phone ?? ""} initialBio={user.bio ?? ""} />
        {/* Публичный профиль продавца — часть P2P-контура. */}
        {user.username && isP2PEnabled() && (
          <p className="mt-3 text-sm">
            <a href={`/u/${user.username}`} className="text-accent hover:underline underline-offset-2">
              Открыть мой публичный профиль →
            </a>
          </p>
        )}
      </div>

      <div className="surface p-5 sm:p-6">
        <h2 className="mb-3 text-lg font-semibold">Способы входа</h2>
        {providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нет привязанных OAuth-аккаунтов (dev-вход).
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {providers.map((p) => (
              <li key={p} className="rounded-pill border border-border px-3 py-1.5 text-sm">
                {PROVIDER_LABELS[p] ?? p}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Привязка дополнительных способов входа появится позже.
        </p>
      </div>
    </section>
  );
}
