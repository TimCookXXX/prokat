#!/usr/bin/env bash
# Готовит карту дорог для OSRM (маршруты «до проката» по дорогам, src/server/routing.ts).
# Берёт свежую выгрузку OpenStreetMap по Южному ФО (Geofabrik; © участники
# OpenStreetMap, ODbL), вырезает агломерацию Краснодара с Адыгеей (Яблоновский,
# Новая Адыгея, Энем) в data/osrm/src и собирает граф профилем scripts/osrm/profile
# (скорости дорог откалиброваны по 2ГИС) — build.sh. Результат — data/osrm/krasnodar.osrm*.
#
# Запуск: bash scripts/osrm/prepare.sh   (нужны curl и docker; ~5 минут, ~2 ГБ памяти)
# Карту стоит обновлять раз в месяц: снова запустить скрипт и перезапустить сервис osrm.
set -euo pipefail

cd "$(dirname "$0")/../.."
SRC=data/osrm/src
SOURCE="${OSRM_SOURCE:-https://download.geofabrik.de/russia/south-fed-district-latest.osm.pbf}"
# Запад, юг, восток, север — с запасом вокруг города и пригородов.
BBOX="${OSRM_BBOX:-38.60,44.85,39.45,45.30}"

mkdir -p "$SRC"
echo "→ Скачиваю выгрузку OSM: ${SOURCE}"
curl -sS --fail -L --retry 3 --max-time 1800 -o "$SRC/region.osm.pbf" "$SOURCE"
ls -lh "$SRC/region.osm.pbf"

echo "→ Вырезаю агломерацию (${BBOX})…"
docker run --rm -v "$PWD/$SRC:/data" debian:bookworm-slim sh -c \
  "apt-get update -qq >/dev/null && apt-get install -y -qq osmium-tool >/dev/null \
   && osmium extract --overwrite -b ${BBOX} -s smart /data/region.osm.pbf -o /data/krasnodar.osm.pbf"
rm -f "$SRC/region.osm.pbf"
ls -lh "$SRC/krasnodar.osm.pbf"

echo "→ Строю граф…"
bash scripts/osrm/build.sh data/osrm
echo "✓ Готово: data/osrm/krasnodar.osrm — перезапустите сервис osrm (docker compose restart osrm)"
