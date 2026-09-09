import { describe, it, expect } from "vitest";
import { missingFromManifest, seedPhotoKey } from "@/lib/seed/photos";

const A = Buffer.from("содержимое первой картинки");
const B = Buffer.from("содержимое второй картинки");

describe("seedPhotoKey", () => {
  it("транслитерирует имя, меняет расширение на webp и добавляет отпечаток", () => {
    expect(seedPhotoKey("Перфоратор 1.JPG", A)).toMatch(/^seed\/perforator-1-[0-9a-f]{8}\.webp$/);
  });

  it("то же содержимое под тем же именем — тот же ключ", () => {
    expect(seedPhotoKey("drill.jpg", A))
      .toBe(seedPhotoKey("drill.jpg", Buffer.from("содержимое первой картинки")));
  });

  // putObject ставит immutable на год. По стабильному ключу заменённый снимок
  // провисел бы в кэше старым, и ловилось бы это мучительно.
  it("другое содержимое под тем же именем — другой ключ", () => {
    expect(seedPhotoKey("drill.jpg", A)).not.toBe(seedPhotoKey("drill.jpg", B));
  });

  // Раньше коллизию слагов разводил счётчик по порядку строк в listings.csv:
  // перестановка строк молча уводила ключ к чужой картинке.
  it("разные файлы с одинаковым слагом не сталкиваются", () => {
    expect(seedPhotoKey("IMG 01.jpg", A)).not.toBe(seedPhotoKey("img-01.png", B));
  });

  it("ключ зависит только от имени и содержимого, а не от истории вызовов", () => {
    const first = seedPhotoKey("a.jpg", A);
    seedPhotoKey("a.jpg", B);
    seedPhotoKey("b.jpg", A);
    expect(seedPhotoKey("a.jpg", A)).toBe(first);
  });

  it("имя без латиницы и цифр не даёт пустой ключ", () => {
    expect(seedPhotoKey("!!!.jpg", A)).toMatch(/^seed\/photo-[0-9a-f]{8}\.webp$/);
  });

  it("путь в имени не вылезает в ключ", () => {
    expect(seedPhotoKey("../../etc/passwd.jpg", A)).toMatch(/^seed\/passwd-[0-9a-f]{8}\.webp$/);
  });
});

describe("missingFromManifest", () => {
  const manifest = { "a.jpg": { key: "seed/a-deadbeef.webp", width: 800, height: 600 } };

  it("называет то, чего в манифесте нет", () => {
    expect(missingFromManifest(["a.jpg", "b.jpg"], manifest)).toEqual(["b.jpg"]);
  });

  it("полный манифест — пустой список", () => {
    expect(missingFromManifest(["a.jpg"], manifest)).toEqual([]);
  });

  it("повторы не дублируются в отчёте", () => {
    expect(missingFromManifest(["b.jpg", "b.jpg"], manifest)).toEqual(["b.jpg"]);
  });
});
