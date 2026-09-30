# Подход D — «поправка в приложении» (префикс D-app)

Граф OSRM не меняется: `profile/` — полная копия рабочего `scripts/osrm/profile` (car.lua,
params.lua, zones.geojson, lib/). Весь выигрыш — на стороне сайта:

1. **Запрос `/table` с `snapping=any`** (главный выигрыш). Точки привязываются к ближайшей
   дороге, включая service/living_street (по умолчанию профиль их запрещает для привязки —
   `snap_to_service=false`). На train при той же формуле `sec + 23` сбалансированная ошибка
   21,4% → 19,1%, короткие 34% → 28%, км медиана 6,5% → 5,5%.
2. **Формула приложения** — лог-линейная, 27 коэффициентов (`app_formula.json`): время
   OSRM, км OSRM, км по прямой (кусочно-линейно в логарифмах), удалённость концов от центра,
   сторона света концов, проход через центр, пересечение Кубани. Км — `distance/1000` без
   поправки (поправки медиану км не улучшили).

## Результат (будний день 13:00)

| | min_balanced | 0–3 | 3–7 | 7–15 | 15+ | средняя | медиана | 90% | км медиана |
|---|---|---|---|---|---|---|---|---|---|
| планка (рабочий, f=1, β=23), val | 20,8% | 28,5 | 21,0 | 18,1 | 15,6 | 20,2 | 16,8 | 40,6 | 8,7% |
| snapping=any, f=1, β=23, val | 19,6% | 25,4 | 20,8 | 17,0 | 15,1 | 19,1 | 16,4 | 37,6 | 7,8% |
| **snapping=any + формула A, val** | **16,9%** | **18,1** | 18,8 | 17,5 | 13,1 | 17,1 | 14,5 | 34,8 | 7,8% |
| формула A, CV по точкам train | 15,6% | 17,6 | 16,7 | 15,1 | 13,0 | 15,6 | 11,9 | | |
| формула A, CV по районам train | 15,8% | 18,1 | 16,7 | 15,4 | 12,9 | 15,7 | 12,4 | | |

Сравнений на val: 4 (планка, snapping=any без формулы, формула B без сторон света — 17,3%,
формула A — 16,9%). Всё подбиралось на train; выбор признаков — по 5-кратной CV по группам
точек (как fit3.py) и строже — по районам (кластеры точек вокруг центров микрорайонов).

## Формула (минуты)

```
x = (lon − 38.9753)·78.62, y = (lat − 45.0355)·111.2   // км от центра, для обеих точек a, b
r = hypot(x, y); d = hypot(xa−xb, ya−yb)                // км по прямой
lk = ln(max(distance_m/1000, 0.1)); ld = ln(max(d, 0.1))
z = c + ls·ln(duration_s + 60) + lk·lk + ld·ld
  + Σ_{K∈0.5,1,2,4,8,15} [ ld>K·max(0, ld − lnK) + lk>K·max(0, lk − lnK) ]
  + Σ_{K∈2,4,6,9,12} r>K·(max(0, ra−K) + max(0, rb−K))
  + rmin<3·[отрезок a–b проходит ближе 3 км от центра]
  + cross·[south(a) ≠ south(b)]      // south: okrugOfPoint = null и lat<45.045 и 38.85<lon<39.20
  + north·(max(0,ya)+max(0,yb)) + south·(max(0,−ya)+max(0,−yb))
  + east·(max(0,xa)+max(0,xb))  + west·(max(0,−xa)+max(0,−xb))
s = clamp(exp(z), 0.6·(duration_s+23), 1.3·(duration_s+23))   // защита от экстраполяции
минуты = s/60;  км = distance_m/1000
```

Коэффициенты и готовая функция на TypeScript — `app_formula.json` (`coef`, `typescript`).
Смысл: время OSRM входит со степенью ≈0,54, остальное добирается длиной (OSRM и по прямой) —
формула «стягивает» время к типичной скорости для такой длины; для коротких поездок это
главное (ошибки OSRM на привязке и одностороннем движении). Удалённость концов от центра
и стороны света — более быстрые окраины и медленный центр.

## Воспроизвести

```bash
cd /Users/timur/Desktop/sravniprokat
PROFILE_DIR=scripts/osrm/calibration/approaches/D-app/profile bash scripts/osrm/build.sh \
  data/osrm/builds/D-base scripts/osrm/calibration/approaches/D-app/profile/params.lua
bash scripts/osrm/calibration/serve.sh data/osrm/builds/D-base 5014 osrm-D
cd data/calibration; PY=…/venv/bin/python; A=../../scripts/osrm/calibration/approaches/D-app
$PY $A/collect_variant.py http://127.0.0.1:5014 approaches/D-app/table_any.json "&snapping=any"
$PY $A/final.py approaches/D-app/table_any.json A approaches/D-app/cand_A     # подбор + CV + fit.json
# (app_formula.json собран из cand_A/fit.json; защита clamp добавлена в apply_formula.py и TS)
$PY $A/apply_formula.py $A/app_formula.json approaches/D-app/table_any.json approaches/D-app/best_pred.json
$PY ../../scripts/osrm/calibration/score_val.py approaches/D-app/best_pred.json
docker rm -f osrm-D
```

Файлы: `collect_table.py`/`collect_variant.py` — то, что видит сайт (/table), `dfeat.py` —
признаки точек (округ по границам OSM, берег Кубани), `dmodel.py` — подборщик (гладкая
сбалансированная |ошибка|), `exp1…exp10.py`, `expkm.py`, `gbm.py` — перебор (бустинг деревьями
глубины 2–3 поверх формулы выигрыша не дал: CV по районам хуже), `final.py`, `apply_formula.py`.

## Что изменить на сайте

- `src/server/routing.ts`: к запросу `/table` добавить `&snapping=any`.
- Вместо `(OSRM_TIME_FACTOR·seconds + OSRM_TIME_BASE_S)/60` — `osrmMinutes(user, shop, distM, durS)`
  из `app_formula.json → typescript` (затем `Math.max(1, Math.round(...))` и TRAFFIC_BY_HOUR — как было).
  Для «≈» (центр микрорайона вместо адреса) формула та же.

## Риски

- Формула знает геометрию Краснодара (центр, стороны света, Кубань) — для другого города
  подбирать заново. Вне диапазона данных (дальше ~46 км по дороге, ~20 км от центра) спасает clamp.
- `snapping=any` может привязать точку к внутридворовому проезду: для коротких поездок это
  в среднем ближе к 2ГИС, но отдельные адреса могут получить странный подъезд.
- val систематически «медленнее» train (2ГИС/OSRM выше на всех длинах); 7–15 км на val формула
  не улучшила (17,0 → 17,5), выигрыш — короткие и длинные.
