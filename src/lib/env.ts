import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().refine(s => s.startsWith("postgres://") || s.startsWith("postgresql://"), {
    message: "DATABASE_URL must be a Postgres connection string",
  }),
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32, "NEXTAUTH_SECRET must be ≥32 chars"),

  // Production-only (валидируется в superRefine ниже)
  DOMAIN: z.string().min(1).optional(),
  LETSENCRYPT_EMAIL: z.string().email().optional(),

  YANDEX_CLIENT_ID: z.string().min(1).optional(),
  YANDEX_CLIENT_SECRET: z.string().min(1).optional(),
  VK_CLIENT_ID: z.string().min(1).optional(),
  VK_CLIENT_SECRET: z.string().min(1).optional(),

  SMTP_HOST:     z.string().min(1).optional(),
  SMTP_PORT:     z.coerce.number().int().positive().optional(),
  SMTP_USER:     z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM:     z.string().email().optional(),

  // Дополняет встроенный список в src/lib/auth/email.ts: домен закрывается
  // рестартом контейнера, без пересборки.
  BLOCKED_EMAIL_DOMAINS: z.string()
    .transform((s) => s.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean))
    .pipe(z.array(z.string()))
    .optional(),

  STORAGE_ENDPOINT:          z.string().url().optional(),
  STORAGE_BUCKET:            z.string().min(1).optional(),
  STORAGE_ACCESS_KEY_ID:     z.string().min(1).optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  STORAGE_PUBLIC_BASE:       z.string().url().optional(),

  BACKUP_S3_ENDPOINT:          z.string().url().optional(),
  BACKUP_S3_BUCKET:            z.string().min(1).optional(),
  BACKUP_S3_ACCESS_KEY_ID:     z.string().min(1).optional(),
  BACKUP_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),

  INDEXNOW_KEY: z.string().regex(/^[a-f0-9]{8,128}$/, "INDEXNOW_KEY must be hex").optional(),
  YANDEX_METRIKA_ID: z.string().regex(/^\d+$/, "YANDEX_METRIKA_ID must be digits").optional(),

  // Геокодер Яндекса для «Где» и импорта адресов прокатов (src/server/geocoder.ts).
  // Без ключей работают микрорайоны, округа и геолокация, но не ввод адреса.
  YANDEX_GEOCODER_API_KEY: z.string().min(1).optional(),
  YANDEX_SUGGEST_API_KEY: z.string().min(1).optional(),

  // Старый P2P-контур: объявления юзеров, календарь занятости, заявки на бронь.
  // Продукт — сравнение цен прокатов, поэтому контур выключен, но не удалён.
  FEATURE_P2P: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
}).superRefine((v, ctx) => {
  for (const p of ["YANDEX", "VK"] as const) {
    const id = (v as Record<string, unknown>)[`${p}_CLIENT_ID`];
    const sec = (v as Record<string, unknown>)[`${p}_CLIENT_SECRET`];
    if (!!id !== !!sec) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [`${p}_CLIENT_SECRET`],
        message: `${p}_CLIENT_ID and ${p}_CLIENT_SECRET must be set together`,
      });
    }
  }

  const storageKeys = [
    "STORAGE_ENDPOINT", "STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID",
    "STORAGE_SECRET_ACCESS_KEY", "STORAGE_PUBLIC_BASE",
  ] as const;
  const storagePresence = storageKeys.map(k => Boolean((v as Record<string, unknown>)[k]));
  const storageAll = storagePresence.every(Boolean);
  const storageNone = storagePresence.every(p => !p);
  if (!storageAll && !storageNone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["STORAGE_BUCKET"],
      message: "STORAGE_* env vars must be all set or all empty",
    });
  }

  // Почта: все или ни одной. Отсутствие SMTP в проде допустимо — регистрация и
  // сброс пароля тогда просто скрыты, вход по уже заведённому паролю работает.
  const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"] as const;
  const smtpPresence = smtpKeys.map(k => Boolean((v as Record<string, unknown>)[k]));
  if (!smtpPresence.every(Boolean) && !smtpPresence.every(p => !p)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SMTP_HOST"],
      message: "SMTP_* env vars must be all set or all empty",
    });
  }

  const backupKeys = [
    "BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET",
    "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY",
  ] as const;
  const backupPresence = backupKeys.map(k => Boolean((v as Record<string, unknown>)[k]));
  const backupAll = backupPresence.every(Boolean);
  const backupNone = backupPresence.every(p => !p);
  if (!backupAll && !backupNone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BACKUP_S3_BUCKET"],
      message: "BACKUP_S3_* env vars must be all set or all empty",
    });
  }

  if (v.NODE_ENV === "production") {
    const required: Array<keyof typeof v> = ["DOMAIN", "LETSENCRYPT_EMAIL"];
    for (const k of required) {
      if (!v[k]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [k as string],
          message: `${String(k)} is required in production`,
        });
      }
    }
    if (!storageAll) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STORAGE_BUCKET"],
        message: "STORAGE_* must be fully configured in production",
      });
    }
  }
});

export type Env = z.infer<typeof schema>;

export function parseEnv(input: Record<string, string | undefined>): Env {
  const normalized: Record<string, string | undefined> = {};
  for (const k of Object.keys(input)) {
    const v = input[k];
    normalized[k] = v === "" ? undefined : v;
  }
  const result = schema.safeParse(normalized);
  if (!result.success) {
    throw new Error("Invalid env: " + result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return result.data;
}

let cached: Env | null = null;
export function getEnv(): Env {
  if (cached) return cached;
  cached = parseEnv(process.env);
  return cached;
}

export function _resetEnvCacheForTests(): void {
  cached = null;
}
