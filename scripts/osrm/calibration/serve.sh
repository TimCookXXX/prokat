#!/usr/bin/env bash
# Поднимает калибровочный OSRM для графа из папки $1 (рабочий на 5001 не трогает).
# bash serve.sh <папка-графа> [порт=5002] [имя-контейнера=osrm-calib]
set -euo pipefail
cd "$(dirname "$0")/../../.."
PORT="${2:-5002}"
NAME="${3:-osrm-calib}"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:5000" -v "$PWD/$1:/data:ro" \
  ghcr.io/project-osrm/osrm-backend:v5.27.1 osrm-routed --algorithm mld --max-table-size 1000 /data/krasnodar.osrm >/dev/null
until curl -sf "http://127.0.0.1:$PORT/nearest/v1/driving/38.97,45.03" >/dev/null; do sleep 1; done
echo "$NAME: $1 на 127.0.0.1:$PORT"
