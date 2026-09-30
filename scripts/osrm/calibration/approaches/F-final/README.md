# Подход F — итоговая модель (префикс F-final)

Итог = **граф подхода B** («поле скоростей», версия X2, `b_result.json`) + **простая формула
приложения** `минуты = (секунды OSRM + 48,75) / 60`. Лог-линейная поправка в духе D поверх
графа B проверена и **не взята**: на CV по train выигрыш ≤0,2 п.п. (в пределах шума), на val она
хуже (15,5% против 15,4%).

## Что входит

| Файл | Что |
|---|---|
| `profile/` | полная копия профиля B: `car.lua` (классы дорог, поле скоростей `field_speed`, выбор маршрута `rate_factors`), `params.lua` (скорости, штрафы, сетка поля `field.q`/`field.q2` 23×18 узлов — поле живёт в `params.lua`, отдельного geojson ячеек нет), `zones.geojson` (зоны для `--location-dependent-data`, как у рабочего профиля), `lib/` |
| `b_params.json`, `b_result.json` | параметры и итог B (val 15,39%, км медиана 5,9%) |
| `f_formula.json` | формула приложения: `mode=simple`, `f=1`, `beta_s=48.75` |
| `predict.py` | прогноз как на сайте: OSRM `/table` + формула |
| `fit_f.py` | проверка поправки D поверх графа: CV по train (фолды по точкам и районам) |

Данные прогонов — `data/calibration/approaches/F-final/` (`table_def.json`, `table_any.json`,
`cand_*`, `pred_B.json`).

## Результат (будний день 13:00)

| | min_balanced | 0–3 | 3–7 | 7–15 | 15+ | медиана | км медиана |
|---|---|---|---|---|---|---|---|
| планка (рабочий профиль, f=1, β=23), val | 20,8% | 28,5 | 21,0 | 18,1 | 15,6 | 16,8 | 8,7% |
| D (рабочий граф + формула), val | 16,9% | 18,1 | 18,8 | 17,5 | 13,1 | 14,5 | 7,8% |
| **F = граф B + (сек + 48,75)/60, val** | **15,4%** | 17,2 | 17,4 | 14,6 | 12,4 | 11,6 | **5,9%** |
| граф B + формула D без сторон света (snapping=any), val | 15,5% | 17,5 | 17,4 | 14,8 | 12,3 | 11,8 | 5,9% |

CV по train (5 фолдов, поправка обучается на 4/5): `sec+β` — 11,5% по точкам / 11,1% по районам;
+ формула D без сторон света — 11,3 / 11,0; полная формула D — 11,4 / 11,3. `snapping=any` на графе B
почти ничего не даёт (профиль B уже привязывает к service: `snap_to_service=true`), поэтому
запрос — как сейчас на сайте, без него. Сравнений на val: 2 (B как есть и B + формула).
Оговорка: граф B подобран на тех же train-парах, так что CV поправки на train оптимистична
в целом, но сравнение вариантов между собой честное; val подтвердил вывод.

## Формула приложения (для TypeScript)

```
// запрос — без изменений:
GET {OSRM_URL}/table/v1/driving/{user};{shop1};…?sources=0&annotations=distance,duration
km      = distance_m / 1000
minutes = (1.0 · duration_s + 48.75) / 60
// на сайте дальше как сейчас: Math.max(1, Math.round(minutes)), затем TRAFFIC_BY_HOUR
```

Признаки — только `duration_s` и `distance_m` из ответа `/table`; геометрия точек не нужна.
На сайте это две константы в `src/lib/compare/config.ts`: `OSRM_TIME_FACTOR = 1` (без изменений),
`OSRM_TIME_BASE_S = 23 → 48.75`. `src/server/routing.ts` менять не нужно.

## Собрать граф и проверить

```bash
cd /Users/timur/Desktop/sravniprokat
PROFILE_DIR=scripts/osrm/calibration/approaches/F-final/profile bash scripts/osrm/build.sh \
  data/osrm/builds/F-final scripts/osrm/calibration/approaches/F-final/profile/params.lua
bash scripts/osrm/calibration/serve.sh data/osrm/builds/F-final 5021 osrm-F
cd data/calibration; PY=…/venv/bin/python; F=../../scripts/osrm/calibration/approaches/F-final
$PY $F/predict.py http://127.0.0.1:5021 work/train_val.jsonl approaches/F-final/pred_B.json
$PY ../../scripts/osrm/calibration/score_val.py approaches/F-final/pred_B.json   # val 15,4%
```

Для продакшена: скопировать `profile/` в `scripts/osrm/profile/` (car.lua, params.lua; zones.geojson
и lib/ совпадают с B) — `prepare.sh`/`build.sh` соберут граф тем же профилем.
