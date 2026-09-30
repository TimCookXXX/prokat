#!/usr/bin/env bash
# Собирает граф OSRM из вырезки агломерации (data/osrm/src/krasnodar.osm.pbf, её
# готовит prepare.sh) нашим профилем scripts/osrm/profile с параметрами params.lua.
#
# bash scripts/osrm/build.sh <папка> [params.lua]   → <папка>/krasnodar.osrm*
# Для экспериментов: PROFILE_DIR (папка с car.lua и lib/, по умолчанию scripts/osrm/profile)
# и LDD (GeoJSON зон с свойством zone, по умолчанию $PROFILE_DIR/zones.geojson).
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="$1"
PARAMS="${2:-scripts/osrm/profile/params.lua}"
IMAGE="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v5.27.1}"
PROFILE_DIR="${PROFILE_DIR:-scripts/osrm/profile}"
LDD="${LDD:-$PROFILE_DIR/zones.geojson}"
SRC=data/osrm/src/krasnodar.osm.pbf

[ -f "$SRC" ] || { echo "Нет $SRC — сначала bash scripts/osrm/prepare.sh"; exit 1; }
mkdir -p "$OUT"
cp "$SRC" "$OUT/krasnodar.osm.pbf"
cp "$PARAMS" "$OUT/params.lua"
cp "$LDD" "$OUT/zones.geojson"
run() {
  docker run --rm -v "$PWD/$OUT:/data" -v "$(cd "$PROFILE_DIR" && pwd):/profile:ro" \
    -e OSRM_PARAMS=/data/params.lua "$IMAGE" "$@"
}
run osrm-extract -p /profile/car.lua --location-dependent-data /data/zones.geojson /data/krasnodar.osm.pbf >/dev/null
run osrm-partition /data/krasnodar.osrm >/dev/null
run osrm-customize /data/krasnodar.osrm >/dev/null
rm -f "$OUT/krasnodar.osm.pbf"
echo "✓ $OUT/krasnodar.osrm"
