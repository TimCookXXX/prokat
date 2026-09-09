import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client, r2Bucket, storageEnv } from "./r2";

export function buildKey(userId: string, ulid: string): string {
  return `uploads/${userId}/${ulid}.webp`;
}

export function buildPublicUrl(key: string): string {
  const base = storageEnv().publicBase;
  if (!base) throw new Error("STORAGE_PUBLIC_BASE not set");
  return `${base.replace(/\/$/, "")}/${key}`;
}

/**
 * Есть ли объект в бакете. Нужен сиду фотографий: манифест в git знает ключ, но
 * не знает, в каком бакете объект лежит, — локальный MinIO и прод это разные
 * хранилища с одним и тем же манифестом. Без этой проверки прогон против
 * пустого прод-бакета счёл бы всё уже залитым и не отправил бы ни байта.
 */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await getR2Client().send(new HeadObjectCommand({ Bucket: r2Bucket(), Key: key }));
    return true;
  } catch (err) {
    const name = (err as { name?: string }).name;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    // Отсутствие объекта — законный ответ. Всё остальное (нет доступа, нет
    // бакета, сеть) прячем под «нет объекта» нельзя: сид молча перезалил бы всё.
    if (name === "NotFound" || name === "NoSuchKey" || status === 404) return false;
    throw err;
  }
}

export async function putObject(opts: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  await getR2Client().send(new PutObjectCommand({
    Bucket: r2Bucket(),
    Key: opts.key,
    Body: opts.body,
    ContentType: opts.contentType,
    CacheControl: "public, max-age=31536000, immutable",
  }));
}
