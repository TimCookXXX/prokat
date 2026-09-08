import { S3Client } from "@aws-sdk/client-s3";

let _client: S3Client | null = null;

// Переменные хранилища читаются из process.env напрямую, а не через getEnv().
// getEnv() валидирует схему окружения целиком — DATABASE_URL, NEXTAUTH_URL,
// NEXTAUTH_SECRET и прочее, — и скрипт, которому нужен ровно бакет
// (scripts/seed-photos.ts заливает фотографии сида в прод-хранилище с локальной
// машины), падал бы на требовании переменных, не имеющих к хранилищу отношения.
// Приложение при этом ничего не теряет: getEnv() зовётся из десятка мест, и
// общая проверка окружения, включая «STORAGE_* заданы все или ни одна»,
// выполняется как раньше.
export function storageEnv() {
  return {
    endpoint: process.env.STORAGE_ENDPOINT,
    bucket: process.env.STORAGE_BUCKET,
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
    publicBase: process.env.STORAGE_PUBLIC_BASE,
  };
}

// Имя getR2Client/r2Bucket историческое (изначально планировалась Cloudflare R2);
// фактически используется Timeweb S3. Переименование идентификаторов — отдельный chore.
export function getR2Client(): S3Client {
  if (_client) return _client;
  const env = storageEnv();
  if (!env.endpoint || !env.accessKeyId || !env.secretAccessKey) {
    throw new Error("Storage not configured");
  }
  _client = new S3Client({
    region: "ru-central1",
    endpoint: env.endpoint,
    // Бакет в пути (`endpoint/bucket/key`), а не поддоменом (`bucket.endpoint/key`).
    // По умолчанию SDK адресует поддоменом, и тогда стиль записи расходится с
    // публичными ссылками: их buildPublicUrl уже собирает как
    // `STORAGE_PUBLIC_BASE/key`, то есть path-style. С локальным S3 поддомен
    // вдобавок не резолвится — имени `bucket.localhost` в DNS нет.
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
  });
  return _client;
}

export function r2Bucket(): string {
  const bucket = storageEnv().bucket;
  if (!bucket) throw new Error("STORAGE_BUCKET not set");
  return bucket;
}

export function _resetR2ClientForTests(): void {
  _client = null;
}
