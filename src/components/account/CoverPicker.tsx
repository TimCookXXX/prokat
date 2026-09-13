"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Brackets } from "@/components/brand/Brackets";
import { Button } from "@/components/ui/button";
import { ProfileCover } from "@/components/account/ProfileCover";
import { AccountHero } from "@/components/account/AccountHero";
import { CabinetHubHeader } from "@/components/account/CabinetHub";
import { COVER_PRESETS, DEFAULT_COVER, isOwnCoverUrl, resolveCoverUrl } from "@/lib/covers";
import { updateCover } from "@/server/actions/profile";
import { cn } from "@/lib/utils";
import { ACCOUNT_COVER_HEIGHT, type AccountIdentity } from "@/components/account/identity";

/* Выбор обложки профиля: стандартные пресеты или своя фотография.
 *
 * Сверху — миниатюра настоящей шапки кабинета с кандидатом: обложка,
 * визитка с аватаром нахлёстом, имя, почта и метрики, всё в уменьшенном
 * масштабе. Клик по плитке ничего не применяет, только меняет кандидата;
 * сохраняет отдельная кнопка внизу.
 *
 * Вход один — экран настроек профиля (ProfileCoverField): выбор лежит прямо
 * на странице. Кнопки на самой обложке больше нет. */

export function CoverChoiceGrid({
  me,
  pendingCount,
  onDone,
}: {
  /** Кто выбирает: обложка (me.coverUrl), имя и цифры для миниатюры шапки. */
  me: AccountIdentity;
  pendingCount: number;
  /** Вызывается после успешного сохранения — пикер закрывает окно. */
  onDone?: () => void;
}) {
  const current = me.coverUrl;
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, startSaving] = useTransition();

  // resolveCoverUrl прячет осиротевшие пресеты (список менялся после выбора).
  const savedUrl = resolveCoverUrl(current);
  const [candidate, setCandidate] = useState(savedUrl);
  // Своя фотография: уже сохранённая или только что загруженная в кандидаты.
  const [ownUrl, setOwnUrl] = useState(isOwnCoverUrl(current) ? current : null);

  const busy = uploading || saving;
  const dirty = candidate !== savedUrl;

  const save = () => {
    setError(null);
    startSaving(async () => {
      const res = await updateCover(candidate);
      if (!res.ok) {
        setError("Не удалось сохранить обложку.");
        return;
      }
      router.refresh();
      onDone?.();
    });
  };

  const pickFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.file?.url) {
        setError(res.status === 503
          ? "Хранилище изображений не настроено (STORAGE_* в .env)."
          : "Не удалось загрузить фотографию.");
        return;
      }
      // Загрузка — ещё не выбор: файл становится кандидатом, сохранит кнопка.
      const url = body.file.url as string;
      setOwnUrl(url);
      setCandidate(url);
    } finally {
      setUploading(false);
      // Один и тот же файл должен выбираться повторно (после ошибки).
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <HeroPreview me={me} pendingCount={pendingCount} coverUrl={candidate} />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {COVER_PRESETS.map((preset) => (
          <Tile
            key={preset.slug}
            label={preset.label}
            active={candidate === preset.url}
            disabled={busy}
            onClick={() => setCandidate(preset.url)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preset.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
          </Tile>
        ))}

        {ownUrl && (
          <Tile
            label="Своё фото"
            active={candidate === ownUrl}
            disabled={busy}
            onClick={() => setCandidate(ownUrl)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ownUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          </Tile>
        )}

        {/* Та же пунктирная зона в скобках, что у фото в форме объявления. */}
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="flex aspect-[3/1] flex-col items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-accent text-sm text-muted-foreground transition-colors hoverable disabled:opacity-60"
        >
          <Brackets size={16} running={uploading} />
          {uploading ? "Загружаем…" : ownUrl ? "Другое фото" : "Загрузить своё"}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => void pickFile(e.target.files)}
      />

      <p className="text-xs text-muted-foreground">
        Обложку видят все на вашей публичной странице. Лучше всего смотрится широкое фото, примерно 4:1.
      </p>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}

      <Button
        onClick={save}
        disabled={busy || !dirty}
        className="w-full sm:w-auto sm:self-end"
      >
        {saving && <Brackets size={12} running className="mr-2 text-current" />}
        {saving ? "Сохраняем…" : "Сохранить"}
      </Button>
    </div>
  );
}

/* Миниатюра шапки кабинета с кандидатом. Это НЕ отдельная вёрстка: внутри
 * рендерятся те же AccountHero и CabinetHubHeader, что и на настоящей
 * странице, на её «дизайнерской» ширине, а ScaledPreview ужимает их
 * transform: scale — превью меняется вместе со страницей само. Своего здесь
 * не рисуется ничего: муляж кнопки «Сменить обложку» ушёл вместе с настоящей
 * кнопкой с обложки, иначе превью показывало бы то, чего на странице нет. */
function HeroPreview({
  me,
  pendingCount,
  coverUrl,
}: {
  me: AccountIdentity;
  pendingCount: number;
  coverUrl: string;
}) {
  const candidate = { ...me, coverUrl };

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none select-none overflow-hidden rounded-lg border border-border bg-background"
    >
      {/* Десктопная страница: обложка во всю ширину + полоса героя. Высота
        * обложки — из той же константы, что у настоящей страницы. */}
      <div className="hidden md:block">
        <ScaledPreview designWidth={1120}>
          <ProfileCover src={coverUrl} className={ACCOUNT_COVER_HEIGHT} />
          <div className="px-4 pb-4">
            <AccountHero me={candidate} pendingCount={pendingCount} />
          </div>
        </ScaledPreview>
      </div>

      {/* Мобильная страница: обложка + верх хаба. */}
      <div className="md:hidden">
        <ScaledPreview designWidth={390}>
          <ProfileCover src={coverUrl} className={ACCOUNT_COVER_HEIGHT} />
          <div className="flex flex-col gap-4 px-4 pb-4">
            <CabinetHubHeader me={candidate} />
          </div>
        </ScaledPreview>
      </div>
    </div>
  );
}

/* Уменьшенная живая копия куска страницы: содержимое рендерится на ширине
 * designWidth (как на настоящем экране) и ужимается transform: scale до
 * ширины контейнера. Высота снаружи — натуральная высота × масштаб. */
function ScaledPreview({
  designWidth,
  children,
}: {
  designWidth: number;
  children: React.ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => {
      const s = outer.clientWidth / designWidth;
      setScale(s);
      setHeight(inner.offsetHeight * s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [designWidth]);

  return (
    <div ref={outerRef} className="relative overflow-hidden" style={{ height: height || undefined }}>
      <div
        ref={innerRef}
        style={{ width: designWidth, transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        {children}
      </div>
    </div>
  );
}

/* Плитка выбора без подписи: картинка говорит сама, название уходит только
 * в aria-label — кнопке без текста без него нельзя. */
function Tile({
  label, active, disabled, onClick, children,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "group relative aspect-[3/1] overflow-hidden rounded-lg border transition-shadow disabled:opacity-60",
        active ? "border-transparent ring-2 ring-primary" : "border-border hover:ring-1 hover:ring-border",
      )}
    >
      {children}
      {active && (
        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" aria-hidden="true" />
        </span>
      )}
    </button>
  );
}
