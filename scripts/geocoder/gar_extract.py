#!/usr/bin/env python3
"""ГАР ФНС (регионы 23 и 01) → CSV агломерации для build.py.

  python gar_extract.py <gar_dir> <out_dir>

<gar_dir> — распакованная выборка gar_xml.zip (папки 23/ и 01/, см. prepare.sh). Пишет:
  gar_objects.csv — адресные объекты агломерации уровней 5–8 (город, НП, СНТ/мкр/кв-л, улица)
                    с родителем по административной иерархии;
  gar_houses.csv  — действующие дома (kind=house) и земельные участки (kind=stead) с цепочкой
                    «НП → элемент планировочной структуры → улица» и почтовым индексом.
XML — одна длинная строка, поэтому записи читаются потоковым регэкспом по кускам (≈2 мин на 9 ГБ).
Действующая запись — ISACTUAL=1 и ISACTIVE=1.
"""
import csv
import glob
import os
import re
import sys
import time
import zlib

ATTR = re.compile(rb'(\w+)="([^"]*)"')
# Корни агломерации (bbox 38.60..39.45 × 44.85..45.30): городской округ Краснодар, районы вокруг, Адыгейск.
ROOTS = {
    ("23", "Краснодар", 5), ("23", "Динской", 2), ("23", "Северский", 2),
    ("01", "Тахтамукайский", 2), ("01", "Теучежский", 2), ("01", "Адыгейск", 5),
}
HOUSE_TYPES = {"1": "влд.", "2": "д.", "3": "двлд.", "4": "г-ж", "5": "зд.", "6": "шахта", "7": "стр.",
               "8": "соор.", "9": "литера", "10": "к.", "11": "подв.", "12": "кот.", "13": "п-б", "14": "ОНС"}
ADD_TYPES = {"1": "к.", "2": "стр.", "3": "соор.", "4": "литера"}


def stream(path, tag):
    """Словари атрибутов записей <TAG .../> (без полного разбора XML)."""
    rec = re.compile(rb"<" + tag + rb" ([^>]*?)/>")
    buf = b""
    # .XML.deflate — сжатые данные из архива ГАР как есть (gar_remote_zip.py): распаковка на лету
    inflate = zlib.decompressobj(-15) if path.endswith(".deflate") else None
    with open(path, "rb") as f:
        while True:
            chunk = f.read(32 << 20 if inflate is None else 4 << 20)
            if not chunk:
                break
            if inflate is not None:
                chunk = inflate.decompress(chunk)
            buf += chunk
            last = 0
            for m in rec.finditer(buf):
                yield {k.decode(): v.decode("utf-8") for k, v in ATTR.findall(m.group(1))}
                last = m.end()
            buf = buf[last:]


def one(gar, region, prefix, required=True):
    fs = sorted(glob.glob(os.path.join(gar, region, prefix + "_2*.XML"))
                + glob.glob(os.path.join(gar, region, prefix + "_2*.XML.deflate")))
    if not fs:
        if not required:
            return None
        raise SystemExit(f"нет файла {region}/{prefix}_*.XML в {gar}")
    return fs[0]


def main():
    gar, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    t0 = time.time()
    today = time.strftime("%Y-%m-%d")

    addr = {}   # objectid → (name, typename, level, region, guid)
    for reg in ("23", "01"):
        for r in stream(one(gar, reg, "AS_ADDR_OBJ"), b"OBJECT"):
            if r.get("ISACTUAL") == "1" and r.get("ISACTIVE") == "1":
                addr[int(r["OBJECTID"])] = (r["NAME"], r["TYPENAME"], int(r["LEVEL"]), reg, r["OBJECTGUID"])
    roots = {oid for oid, (n, t, lvl, reg, g) in addr.items() if (reg, n, lvl) in ROOTS}
    print("адресных объектов", len(addr), "корней", len(roots), f"{time.time() - t0:.0f}s", flush=True)
    if len(roots) < len(ROOTS):
        raise SystemExit(f"найдены не все корни агломерации: {[addr[o][:3] for o in roots]}")

    path_of = {}
    for reg in ("23", "01"):
        for r in stream(one(gar, reg, "AS_ADM_HIERARCHY"), b"ITEM"):
            if r.get("ISACTIVE") != "1":
                continue
            p = r["PATH"].split(".")
            if len(p) > 1 and roots.intersection(int(x) for x in p[:3]):
                path_of[int(r["OBJECTID"])] = [int(x) for x in p]
    print("связей иерархии", len(path_of), f"{time.time() - t0:.0f}s", flush=True)

    def chain(oid):
        """(НП, элемент план. структуры, улица) — objectid по пути в иерархии (ближайшие к объекту)."""
        settle = plan = street = 0
        for x in path_of[oid][:-1]:
            a = addr.get(x)
            if not a:
                continue
            lvl = a[2]
            if lvl in (5, 6):
                settle, plan, street = x, 0, 0
            elif lvl == 7:
                plan, street = x, 0
            elif lvl == 8:
                street = x
        return settle, plan, street

    with open(os.path.join(out, "gar_objects.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["objectid", "guid", "level", "region", "type", "name", "settlement", "plan", "root"])
        n = 0
        for oid, p in path_of.items():
            a = addr.get(oid)
            if not a or a[2] not in (5, 6, 7, 8):
                continue
            settle, plan, _ = chain(oid)
            root = next((x for x in p if x in roots), 0)
            w.writerow([oid, a[4], a[2], a[3], a[1], a[0], settle, plan, root])
            n += 1
    print("объектов уровней 5–8", n, flush=True)

    houses = {}
    for reg in ("23", "01"):
        for r in stream(one(gar, reg, "AS_HOUSES"), b"HOUSE"):
            if r.get("ISACTUAL") != "1" or r.get("ISACTIVE") != "1":
                continue
            oid = int(r["OBJECTID"])
            if oid in path_of:
                houses[oid] = r
    print("домов", len(houses), f"{time.time() - t0:.0f}s", flush=True)

    steads = {}
    for reg in ("23", "01"):
        for r in stream(one(gar, reg, "AS_STEADS"), b"STEAD"):
            if r.get("ISACTUAL") != "1" or r.get("ISACTIVE") != "1":
                continue
            oid = int(r["OBJECTID"])
            if oid in path_of:
                steads[oid] = r
    print("участков", len(steads), f"{time.time() - t0:.0f}s", flush=True)

    # Почтовый индекс дома (TYPEID=5), действующее значение — ENDDATE в будущем.
    postcode = {}
    for reg in ("23", "01"):
        path = one(gar, reg, "AS_HOUSES_PARAMS", required=False)
        if path is None:
            print(f"нет {reg}/AS_HOUSES_PARAMS — без почтовых индексов", flush=True)
            continue
        for r in stream(path, b"PARAM"):
            if r.get("TYPEID") != "5" or r.get("ENDDATE", "") < today:
                continue
            oid = int(r["OBJECTID"])
            if oid in houses:
                postcode[oid] = r["VALUE"]
    print("индексов", len(postcode), f"{time.time() - t0:.0f}s", flush=True)

    with open(os.path.join(out, "gar_houses.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["objectid", "guid", "kind", "settlement", "plan", "street", "housetype", "housenum",
                    "addtype1", "addnum1", "addtype2", "addnum2", "postcode"])
        for oid, r in houses.items():
            settle, plan, street = chain(oid)
            w.writerow([oid, r["OBJECTGUID"], "house", settle, plan, street,
                        HOUSE_TYPES.get(r.get("HOUSETYPE", ""), ""), r.get("HOUSENUM", ""),
                        ADD_TYPES.get(r.get("ADDTYPE1", ""), ""), r.get("ADDNUM1", ""),
                        ADD_TYPES.get(r.get("ADDTYPE2", ""), ""), r.get("ADDNUM2", ""), postcode.get(oid, "")])
        for oid, r in steads.items():
            settle, plan, street = chain(oid)
            w.writerow([oid, r["OBJECTGUID"], "stead", settle, plan, street, "", r.get("NUMBER", ""),
                        "", "", "", "", ""])
    with open(os.path.join(out, "version.txt"), "w") as f:
        m = re.search(r"_(\d{8})_", os.path.basename(one(gar, "23", "AS_HOUSES")))
        f.write((m.group(1)[:4] + "-" + m.group(1)[4:6] + "-" + m.group(1)[6:]) if m else today)
    print("готово", f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
