#!/usr/bin/env bash
# Собирает адресный индекс своего геокодера (подсказки «Где», координаты адресов, адреса прокатов при
# CSV-импорте) и пишет его в Postgres: geo_places / geo_streets / geo_houses / geo_pois (+ geo_imports).
# Источники: OpenStreetMap (© участники OpenStreetMap, ODbL) — своя вырезка из выгрузки Geofabrik по Южному ФО,
# шире карты OSRM (38.40..39.70 × 44.60..45.45: районы ГАР целиком, Северская и Пластуновская не на краю),
# data/geocoder/raw/osm/agglomeration.osm.pbf; ГАР ФНС России (fias.nalog.ru, открытые данные) —
# регионы 23 и 01, только нужные таблицы, скачиваются из полного gar_xml.zip по HTTP Range (~1 ГБ из 58) и
# хранятся сжатыми, как в архиве (*.XML.deflate, ~1 ГБ на диске; распакованные XML заняли бы ~8 ГБ).
#
# Запуск: bash scripts/geocoder/prepare.sh            (нужны docker, curl; DATABASE_URL — из окружения или .env)
#   GEOCODER_REFRESH_GAR=1  — перекачать ГАР, даже если выгрузка уже есть в data/geocoder/raw/gar
#   GEOCODER_REFRESH_OSM=1  — перекачать выгрузку OSM и вырезать заново (иначе берётся готовая вырезка)
#   GEOCODER_PBF=<файл>     — своя вырезка OSM вместо скачивания (должна покрывать GEOCODER_BBOX)
#   GEOCODER_BBOX=w,s,e,n   — вырезка OSM (по умолчанию 38.40,44.60,39.70,45.45)
#   GEOCODER_PYTHON=<python> — без docker, своим python (pip: osmium shapely numpy psycopg[binary] rapidfuzz)
#   GEOCODER_CITY=krasnodar — город сайта (cities.slug), по умолчанию krasnodar
# Время: скачивание ГАР ~6 мин, OSM ~1 мин (315 МБ) + вырезка ~10 с, разбор ГАР ~2 мин, OSM ~30 с,
# сборка и запись ~1 мин. Памяти — ~4 ГБ. Диск: data/geocoder/raw ≈ 1,1 ГБ (ГАР сжатым + вырезка OSM 30 МБ;
# на время скачивания OSM — ещё 315 МБ), data/geocoder/work ≈ 130 МБ.
# Сервер подхватит новые данные сам (сверяет версию раз в минуту), перезапуск не нужен.
# Обновлять вместе с картой OSRM раз в месяц; ГАР ФНС обновляет еженедельно.
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$PWD"
OSM_DIR=data/geocoder/raw/osm
PBF="${GEOCODER_PBF:-$OSM_DIR/agglomeration.osm.pbf}"
OSM_SOURCE="${GEOCODER_OSM_SOURCE:-https://download.geofabrik.de/russia/south-fed-district-latest.osm.pbf}"
export GEOCODER_BBOX="${GEOCODER_BBOX:-38.40,44.60,39.70,45.45}"
GAR_DIR=data/geocoder/raw/gar
WORK=data/geocoder/work
CITY="${GEOCODER_CITY:-krasnodar}"
mkdir -p "$GAR_DIR" "$WORK/gar" "$OSM_DIR"

if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//')"
fi
: "${DATABASE_URL:?DATABASE_URL не задан (окружение или .env)}"

# Своя вырезка OSM (не карта OSRM: та уже, и край агломерации терял дома ГАР на улицах без точки)
if [ -z "${GEOCODER_PBF:-}" ] && { [ "${GEOCODER_REFRESH_OSM:-0}" = "1" ] || [ ! -f "$PBF" ]; }; then
  echo "→ Скачиваю выгрузку OSM: ${OSM_SOURCE}"
  curl -sS --fail -L --retry 3 --max-time 1800 -o "$OSM_DIR/region.osm.pbf" "$OSM_SOURCE"
  echo "→ Вырезаю ${GEOCODER_BBOX}…"
  docker run --rm -v "$ROOT/$OSM_DIR:/data" debian:bookworm-slim sh -c \
    "apt-get update -qq >/dev/null && apt-get install -y -qq osmium-tool >/dev/null \
     && osmium extract --overwrite -b ${GEOCODER_BBOX} -s smart /data/region.osm.pbf -o /data/agglomeration.osm.pbf"
  rm -f "$OSM_DIR/region.osm.pbf"
fi
[ -f "$PBF" ] || { echo "Нет вырезки OSM $PBF"; exit 1; }

# python: свой (GEOCODER_PYTHON) или одноразовый контейнер из образа inrenta-geocoder-py (собирается здесь же)
if [ -n "${GEOCODER_PYTHON:-}" ]; then
  py() { "$GEOCODER_PYTHON" "$@"; }
  export GEOCODER_DB_URL
  DB_URL="$DATABASE_URL"
else
  NET=(--network host)
  DB_URL="$DATABASE_URL"
  if [ "$(uname -s)" = "Darwin" ]; then
    # Docker Desktop: localhost хоста из контейнера — host.docker.internal
    NET=(--add-host=host.docker.internal:host-gateway)
    DB_URL="$(echo "$DATABASE_URL" | sed -E 's#@(localhost|127\.0\.0\.1)([:/])#@host.docker.internal\2#')"
  fi
  # образ с зависимостями собирается один раз (кэш docker): python:3.12-slim + libexpat (нужна pyosmium)
  docker build -q -t inrenta-geocoder-py - >/dev/null <<'DOCKERFILE'
FROM python:3.12-slim
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends libexpat1 >/dev/null \
 && rm -rf /var/lib/apt/lists/* \
 && pip install -q --no-cache-dir --disable-pip-version-check --root-user-action=ignore \
      osmium shapely numpy "psycopg[binary]" rapidfuzz
DOCKERFILE
  py() {
    docker run --rm "${NET[@]}" -e GAR_URL -e GEOCODER_DB_URL -e GEOCODER_BBOX -v "$ROOT:/work" -w /work \
      inrenta-geocoder-py python "$@"
  }
fi

py scripts/geocoder/textnorm.py --selftest
py scripts/geocoder/build.py --selftest

if [ "${GEOCODER_REFRESH_GAR:-0}" = "1" ] || ! ls "$GAR_DIR"/23/AS_HOUSES_2*.XML* >/dev/null 2>&1; then
  echo "→ Ссылка на свежую выгрузку ГАР…"
  GAR_URL="$(curl -sS --fail --max-time 60 https://fias.nalog.ru/WebServices/Public/GetLastDownloadFileInfo \
    | sed -E 's/.*"GarXMLFullURL":"([^"]+)".*/\1/')"
  case "$GAR_URL" in http*) ;; *) echo "Не удалось получить ссылку на ГАР"; exit 1 ;; esac
  echo "→ Скачиваю регионы 23 и 01 из ${GAR_URL} (по HTTP Range, ~1 ГБ, без распаковки)…"
  rm -rf "$GAR_DIR/23" "$GAR_DIR/01"
  PREFIXES=()
  for r in 23 01; do
    for t in AS_ADDR_OBJ_2 AS_ADM_HIERARCHY_ AS_HOUSES_2 AS_HOUSES_PARAMS_ AS_STEADS_2; do PREFIXES+=("$r/$t"); done
  done
  export GAR_URL
  py scripts/geocoder/gar_remote_zip.py get "$GAR_DIR" "${PREFIXES[@]}"
fi

echo "→ ГАР: дома, участки, улицы агломерации…"
py scripts/geocoder/gar_extract.py "$GAR_DIR" "$WORK/gar"
echo "→ OSM: адреса, здания, улицы, места…"
py scripts/geocoder/osm_extract.py "$PBF" "$WORK/osm.pkl"
echo "→ Сборка индекса и запись в БД…"
GEOCODER_DB_URL="$DB_URL" py scripts/geocoder/build.py --osm "$WORK/osm.pkl" --gar "$WORK/gar" \
  --geo-data src/lib/compare/geo-data.ts --city "$CITY" --report "$WORK/report.md" --write-db
echo "✓ Готово: отчёт $WORK/report.md. JSON для тестов и замера — pnpm db:export-geo"
