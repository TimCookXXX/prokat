#!/usr/bin/env bash
# Готовит карту дорог для OSRM (маршруты «до проката» по дорогам, src/server/routing.ts).
# Берёт свежую выгрузку OpenStreetMap по Южному ФО (Geofabrik; © участники
# OpenStreetMap, ODbL), вырезает агломерацию Краснодара с Адыгеей (Яблоновский,
# Новая Адыгея, Энем) и собирает граф профилем car (алгоритм MLD).
# Результат — data/osrm/krasnodar.osrm*.
#
# Запуск: bash scripts/osrm/prepare.sh   (нужны curl и docker; ~5–10 минут, ~2 ГБ памяти)
# Карту стоит обновлять раз в месяц: снова запустить скрипт и перезапустить сервис osrm.
set -euo pipefail

cd "$(dirname "$0")/../.."
OUT=data/osrm
IMAGE="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v5.27.1}"
SOURCE="${OSRM_SOURCE:-https://download.geofabrik.de/russia/south-fed-district-latest.osm.pbf}"
# Запад, юг, восток, север — с запасом вокруг города и пригородов.
BBOX="${OSRM_BBOX:-38.60,44.85,39.45,45.30}"

mkdir -p "$OUT"
echo "→ Скачиваю выгрузку OSM: ${SOURCE}"
curl -sS --fail -L --retry 3 --max-time 1800 -o "$OUT/region.osm.pbf" "$SOURCE"
ls -lh "$OUT/region.osm.pbf"

echo "→ Вырезаю агломерацию (${BBOX})…"
docker run --rm -v "$PWD/$OUT:/data" debian:bookworm-slim sh -c \
  "apt-get update -qq >/dev/null && apt-get install -y -qq osmium-tool >/dev/null \
   && osmium extract --overwrite -b ${BBOX} -s smart /data/region.osm.pbf -o /data/krasnodar.osm.pbf"
rm -f "$OUT/region.osm.pbf"
ls -lh "$OUT/krasnodar.osm.pbf"

run() { docker run --rm -v "$PWD/$OUT:/data" "$IMAGE" "$@"; }
echo "→ Строю граф…"
run osrm-extract -p /opt/car.lua /data/krasnodar.osm.pbf
run osrm-partition /data/krasnodar.osrm
run osrm-customize /data/krasnodar.osrm
rm -f "$OUT/krasnodar.osm.pbf"
echo "✓ Готово: $OUT/krasnodar.osrm — запустите сервис osrm (docker compose up -d osrm)"
