"""Чтение gar_xml.zip (57 ГБ) по HTTP Range: список файлов и выборочная выгрузка регионов.
Использование:
  python gar_remote_zip.py list [prefix]
  python gar_remote_zip.py get <outdir> <prefix> [<prefix>...]

`get` не распаковывает: сжатые данные файла архива копируются как есть в <имя>.XML.deflate (сырой
deflate, ~1 ГБ на регионы 23 и 01 против ~8 ГБ XML), gar_extract.py читает их потоком. Файл без
сжатия (stored) пишется как <имя>.XML.
"""
import sys, io, os, struct, zipfile, urllib.request

URL = os.environ.get("GAR_URL", "https://fias-file.nalog.ru/downloads/2026.09.29/gar_xml.zip")

class HttpRange(io.RawIOBase):
    def __init__(self, url):
        self.url = url
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=60) as r:
            self.size = int(r.headers["Content-Length"])
        self.pos = 0
        self.bytes_fetched = 0
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        if whence == 0: self.pos = off
        elif whence == 1: self.pos += off
        else: self.pos = self.size + off
        return self.pos
    def read(self, n=-1):
        if n is None or n < 0: n = self.size - self.pos
        if n == 0 or self.pos >= self.size: return b""
        end = min(self.pos + n, self.size) - 1
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = r.read()
                break
            except Exception as e:
                if attempt == 4: raise
        self.pos += len(data); self.bytes_fetched += len(data)
        return data
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)

def save_member(f, info, dst):
    """Сжатые байты файла архива → dst(.deflate) без распаковки; f — seekable-поток архива. Путь записанного файла."""
    if info.compress_type not in (zipfile.ZIP_DEFLATED, zipfile.ZIP_STORED):
        raise SystemExit(f"{info.filename}: сжатие {info.compress_type} не поддерживается")
    f.seek(info.header_offset)
    head = f.read(30)
    sig, *_rest = struct.unpack("<IHHHHHIIIHH", head)
    if sig != 0x04034B50:
        raise SystemExit(f"{info.filename}: не найден локальный заголовок")
    name_len, extra_len = struct.unpack("<HH", head[26:30])
    f.seek(info.header_offset + 30 + name_len + extra_len)
    out = dst + (".deflate" if info.compress_type == zipfile.ZIP_DEFLATED else "")
    left = info.compress_size
    tmp = out + ".part"
    with open(tmp, "wb") as o:
        while left > 0:
            chunk = f.read(min(left, 8 << 20))
            if not chunk:
                raise SystemExit(f"{info.filename}: архив оборвался")
            o.write(chunk); left -= len(chunk)
    os.replace(tmp, out)
    return out


def main():
    f = io.BufferedReader(HttpRange(URL), buffer_size=8 << 20)
    z = zipfile.ZipFile(f)
    cmd = sys.argv[1]
    if cmd == "list":
        pref = sys.argv[2] if len(sys.argv) > 2 else ""
        tot = 0
        for i in z.infolist():
            if i.filename.startswith(pref):
                print(f"{i.file_size:>14} {i.compress_size:>12} {i.filename}"); tot += i.compress_size
        print("compressed total", tot, file=sys.stderr)
    elif cmd == "get":
        out = sys.argv[2]
        for i in z.infolist():
            if any(i.filename.startswith(p) for p in sys.argv[3:]) and not i.is_dir():
                dst = os.path.join(out, i.filename); os.makedirs(os.path.dirname(dst), exist_ok=True)
                save_member(f, i, dst)
                print("ok", i.filename, i.file_size, "сжато", i.compress_size, flush=True)

if __name__ == "__main__":
    main()
