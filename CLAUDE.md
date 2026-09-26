# inrenta — сравнение цен прокатов

inrenta — не маркетплейс, а сравнение: собираем цены и условия прокатов города и
показываем **итоговую сумму за даты пользователя** у каждого проката (аренда с
минимальным сроком и недельным тарифом; залог — отдельно) и **дорогу до проката** от
места пользователя. Версия 1 — только самовывоз: доставка хранится и показывается
справочно, в итог не входит. Мы ничего не сдаём, не берём оплату и не держим залоги:
человек звонит прокату напрямую. Деньги — позже, с прокатов за обращения клиентов.
Старт — Краснодар: инструмент, уборка и модели электровелосипедов для курьеров; но
категории, классы, модели и места — **данные, а не код**: модель должна принимать любые
новые категории.

**Действующее ТЗ версии 1 — `TZ.md`** (вход «Что · Когда · Где», расчёт, выдача, 25
критериев приёмки). При расхождении с пакетом `docs/inrenta-pivot/` (`PRODUCT.md`,
`MIGRATION.md`, `DATA_MODEL.md`, `DESIGN_SYSTEM.md`, макеты `mockups/*B.dc.html`) прав
`TZ.md`. Файлы `docs/` в сборку и `tsc` не входят — это эталон, рабочие копии в `src/`.

Это самостоятельный проект. Общение и UI — на русском; идентификаторы кода и
commit-сообщения — на английском.

### Старый P2P-контур (за флагом `FEATURE_P2P`)

Исходный продукт — C2C-маркетплейс (юзер размещает вещи, бронирует чужие, заявки
подтверждает владелец). Он **не удалён, а выключен** флагом `FEATURE_P2P` (env, по
умолчанию `false`; `src/lib/features.ts`):

- его страницы (`/cabinet/*`, `/requests`, `/u/…`, `/search`, карточки и списки объявлений, `/admin/{listings,requests}`) → 404 (`requireP2P()`);
- Server Actions `actions/owner.ts`, `actions/booking.ts` → `{ ok: false, error: "p2p_disabled" }`;
- входы в UI скрыты: «Разместить», поиск по объявлениям, таб-бар, P2P-пункты меню/кабинета/подвала, sitemap.

С флагом P2P добавляется **поверх** сравнения (главная и `/{city}` остаются сравнением).
Новый код P2P-контур не использует и не расширяет. Описание P2P — в конце файла.

## Стек

- **Fullstack:** Next.js 15 (App Router, Server Components, Server Actions), React 19, TypeScript. SSR на всех публичных страницах.
- **БД:** PostgreSQL 16 (docker-compose) + Drizzle ORM. Схема — единственный источник в `drizzle/schema.ts`.
- **Auth:** Auth.js v5 (`@auth/drizzle-adapter`) — Яндекс ID, VK ID (свой OAuth 2.1 + PKCE, `src/lib/auth/oauth-vk.ts`) и почта с паролем (argon2id + подтверждение по письму, `src/lib/auth/flows.ts`). Сессии — database, `src/lib/auth/session.ts`. В сравнении вход нужен только прокатам и админу.
- **Storage:** S3-совместимое (Yandex Object Storage); `/api/upload` (`sharp` → webp).
- **Стили:** Tailwind + CSS-токены `theme/tokens.css` (дизайн-система «вариант Б»), шрифты Unbounded + Onest (`theme/fonts.ts`), светлая тема по умолчанию + тёмная (`next-themes`).
- **ID:** ULID (`newId()` в `src/lib/id.ts`). **Цены:** целые рубли. **Даты:** строки `YYYY-MM-DD`. **Слаги:** `slugify()`.
- **Аналитика:** Яндекс Метрика (цели через `reachGoal()` в `src/lib/analytics.ts`) + серверные `lead_events`.
- **Тесты:** Vitest (490 тестов, только в `tests/**`, импорт через `@/`).
- **Деплой:** docker-compose (Caddy + app + Postgres + backup), HTTPS via Let's Encrypt. См. `docs/DEPLOY.md`, `docs/RECOVERY.md`.

## Команды

```bash
pnpm dev            # dev-сервер (http://localhost:3000)
pnpm build          # production-сборка (перед сборкой остановить dev — общий .next)
pnpm test           # vitest
pnpm exec tsc --noEmit   # проверка типов всего проекта
pnpm check-theme    # все токены на месте в :root и .dark
pnpm db:generate    # drizzle-kit: сгенерировать миграцию из drizzle/schema.ts
pnpm db:migrate     # применить миграции (.env → DATABASE_URL)
pnpm db:seed        # тестовые данные (идемпотентно)
pnpm db:sync-catalog    # справочник сравнения → БД (в проде — сам при старте контейнера)
pnpm db:import-offers <file.csv> [--dry-run]   # прокаты и цены из CSV
pnpm db:studio      # drizzle studio
```

`pnpm lint` (`next lint`) в проекте не настроен — спрашивает конфиг ESLint.

## Модель данных сравнения (`drizzle/schema.ts`, нижний блок)

Цепочка: **`categories → item_groups → item_classes ← offers → rental_shops → cities`**,
плюс **`brands → product_models ← offers`**, **`model_aliases → product_models`** и
**`districts` (округ → микрорайон) ← `rental_shops`**.

| Таблица | Назначение | Ключевое |
|---|---|---|
| **item_groups** | страница группы `/{city}/{slug}` (`prokat-perforatora`), классы группы показываются вместе | `categoryId`, `slug` (uniq, делит сегмент с категориями), `nameGenitive` (H1), `seoWord` (`prokat`/`arenda`), `guide`, `searchKeywords` («болгарка», «отбойник») |
| **item_classes** | класс сравнения (SDS-plus / SDS-max) — чип на странице группы | `groupId`, `slug` (uniq, по нему ищет CSV-импорт), `shortHint`, `searchKeywords`; чип уточнения («Моющий») — `chip` в `catalog-data.ts` |
| **brands**, **product_models** | бренд и модель; семейство (HR2470 / HR2470FT) — одна модель. Страница модели `/{city}/{seoWord}-{slug}` | модель: `brandId`, `itemClassId`, `name` (без бренда), `slug`, `family`, `specs` jsonb, фото с лицензией |
| **model_aliases** | написание → модель (ключ `modelKey()`) | `alias` PK |
| **districts** | места для «Где»: `okrug` (4 округа) и `microdistrict` (центр, синонимы «ФМР», «Фестивалка», `parentId` → округ) | uniq (`cityId`,`slug`) |
| **rental_shops** | прокат; существует без владельца | `address`, `lat`/`lon` (координаты адреса), `microdistrictId`, `okrugId`, `hours` jsonb (`WeekHours`), телефон (только по клику), `telegram`, `status` (`unclaimed`/`claimed`/`hidden`), `ownerUserId` |
| **offers** | цена и условия проката | uniq (`shopId`,`itemClassId`,`modelKey`); `modelId` (NULL — не указана или не распознана), `model` (как написал прокат), `modelKey` (`m:<id>` / `r:<ключ>` / `''`), `includes`; `priceDay` / `priceWeek` (хотя бы одна), `minDays`, `depositRub` (**NULL = «уточняется», 0 = без денежного**), доставка (справочно), `verifiedAt` + `verifiedBy` |
| **lead_events** | обращения: `show_phone`, `request`, `regular_request`, `price_outdated`, `claim_click`, `map_open` | `offerId`, `shopId`, `itemClassId`, `modelId`, `sessionId` (cookie `inr_sid`), `tab`, `rankPosition`, `scenario` (`LeadScenario`: сутки, тип места, микрорайон/округ), `utm` |
| **regular_requests** | заявки `kind`: `regular` («нужен регулярно») и `not_found` («не нашли — найдём за 30 минут») | `what`, `period`, `frequency`, `contact`, `status` |
| **shop_claims** | заявки «Это мой прокат» | `shopId` (NULL — проката нет в базе, тогда `shopName`), `userId`, `phone`, `status` |

- Справочники — **код**; `syncCatalog()` (`db:sync-catalog`, в проде — при старте контейнера) приводит к ним БД upsert по slug: группы и классы — `src/lib/compare/catalog-data.ts`; места — `geo-data.ts` (OpenStreetMap, ODbL — источник указан в подвале и на `/kak-schitaem-ceny`); бренды и модели — `models-data.ts` (ключи написаний → `model_aliases`, ранее нераспознанные предложения привязываются к моделям). Границы округов — `okrug-bounds.ts`: округ точки без внешних сервисов. Города и категории правятся в админке — синхронизация их только создаёт. Слаги `prokaty` и `poisk` зарезервированы.
- Прокаты и цены — CSV-импорт (`offers-csv.ts` → `import-offers.ts`, шаблон `docs/inrenta-pivot/data/offers.template.csv`):
  - файл целиком или ничего; строки-примеры отклоняются;
  - прокат ищется по (город, название, телефон);
  - модель — через `modelKey()` и `model_aliases`; не нашлась — предложение класса и отчёт «нераспознанные модели»;
  - микрорайон — по справочнику мест; адрес без `lat`/`lon` геокодируется (Яндекс, если есть ключ), иначе — отчёт «адреса без координат»;
  - часы — «пн-пт 9-20; сб 10-16; вс выходной» (`hours.ts`);
  - более старая `verifiedAt` не затирает свежую.
- `cities.namePrepositional` — «в Краснодаре» для заголовков.

### Расчёт и выдача (`pricing.ts`, `ranking.ts`, `view.ts`; параметры — `config.ts`)

- Итог считается **только** в `pricing.ts` и не хранится. Оплачиваемые сутки = max(сутки, `minDays`); без `priceDay` — целые недели. Недельный тариф: недели × `priceWeek` + min(остаток × `priceDay`, `priceWeek`). Месячного тарифа нет. **Доставка в итог не входит** (версия 1 — самовывоз).
- Срок — **датами** (сб 27 → пн 29 = 2 суток, минимум 1). Дат нет — сегодня на 1 сутки и пометка «укажите даты». Календарь — свой (`DateRangeField`, `calendar.ts`): два клика в любом порядке (`pickRangeDay`).
- Место проката: координаты адреса → центр микрорайона (≈) → неизвестно. Путь — **по дорогам** (`src/server/routing.ts`, цепочка `Router`, одна матрица «пользователь → точки прокатов» на страницу): 1) Яндекс Матрица расстояний (`YANDEX_ROUTING_API_KEY`, отдельный платный ключ; расстояние и время с пробками, как на Яндекс Картах; до 100 точек за запрос, кэш 10 мин); 2) свой OSRM (`OSRM_URL`, сервис `osrm` в compose, граф `scripts/osrm/prepare.sh` → `data/osrm/`; время = км ÷ `CITY_SPEED_KMH`, кэш сутки); 3) по прямой × `ROUTE_FACTOR` (1,3) — ошибается через Кубань. Непосчитанные точки досчитывает следующий; «≈», если хоть одна точка — центр микрорайона (`geo.ts`).
- Оценка «Оптимального» = итог + `TRIPS_PER_RENTAL` (4) × минуты × `MINUTE_COST_RUB` (10).
- Вкладки (`ranking.ts`):
  - город — «Оптимальный» (он же «Самый дешёвый») и «Самый дешёвый»;
  - округ — плюс «Сначала в вашем округе», выдача делится на «в вашем округе» и «в других»;
  - микрорайон и точка — плюс «Ближе всего».
  По умолчанию «Ближе всего», если разброс итогов меньше `LOW_SPREAD_SHARE` и расстояния известны; иначе «Оптимальный».
- Порядок:
  - доминируемое (дороже и не ближе другого) не бывает первым (`undominatedFirst`);
  - без местоположения — после известных на «Оптимальном» и «Ближе всего»;
  - при равенстве выше подтверждённый прокат, затем свежая цена.
  Под первым — пояснение: «На 100 ₽ дороже самого дешёвого, но в 3 раза ближе».
- Цена старше `STALE_AFTER_DAYS` (30) → блок «Цена на перепроверке», вне вкладок. Фильтры — у каждого итог первой карточки текущей вкладки после его применения (ТЗ, критерий 21; на «Самом дешёвом» это и минимум, там подпись «от»): без денежного залога, подтвердил цены, от 1 суток, работает сегодня (`hours.ts`, время Москвы), модель, округ. Подсказка про неделю — при выгоде от `WEEK_HINT_MIN_SHARE`.
- Параметры URL — `scenario.ts` (`targetHref` — адрес цели поиска); «сегодня» — `localToday()` (Москва).

### Поиск «Что · Когда · Где»

- **Что** (`search.ts`, `WhatField`): подсказки по мере набора — модели и классы по 5 с числом прокатов. Индекс из каталога, брендов и моделей города (`getSearchData`), ищется на клиенте. Выбор подсказки — сразу цель.
- Текст без выбора → `/{city}/poisk?q=`, где `resolveQuery()` разбирает запрос по уровням ТЗ:
  1. модель — страница модели (несколько моделей одного класса — фильтр по ним);
  2. бренд (+ класс);
  3. класс или группа;
  4. неоднозначное слово — чипы, до выбора показываются все подходящие классы;
  5. запасной `ILIKE '%q%'` по написанию моделей у прокатов (`findGroupsByRawModel`);
  6. не найдено — «похожее» и форма «найдём за 30 минут».

  Поиск не зависит от регистра, дефисов и косых черт; понимает кириллицу вместо латиницы и похожие буквы («НR2470»), неверную раскладку, до 2 опечаток, падежи (`stem`), синонимы групп, классов и брендов.
- **Где** (`WhereField`, `geo.ts`):
  - микрорайоны и округа — сразу из справочника (`matchPlaces`, синонимы и раскладка);
  - адреса — Геосаджест Яндекса через `/api/geo/suggest` (задержка 300 мс), координаты — `/api/geo/resolve` (`src/server/geocoder.ts`: кэш, лимит `geo`); без ключей адреса не подсказываются, остальное работает;
  - «Определить моё местоположение» — геолокация браузера, отказ — без ошибки;
  - ввели и не выбрали — берётся первая подсказка, иначе город и «Не нашли такой адрес — уточните»;
  - последнее место хранится в `localStorage` (`inr_loc`) и подставляется на главной.
- Место в URL: `loc=d:<микрорайон>` | `o:<округ>` | `p:<lat>,<lon>` (+ `la` — подпись, `src=geo`). Округ и микрорайон точки определяются по границам OSM и ближайшему центру и показываются в сводке.

## URL-структура

| URL | Что |
|---|---|
| `/`, `/{city}` | главная (город по умолчанию — `krasnodar`): поиск «Что · Когда · Где», популярные классы и модели с ценой «от», «Как мы считаем цены» |
| `/{city}/{group}` | **страница группы**, все классы вместе: `?c=класс&brand=&model=a,b&from&to&loc=&la=&src=&tab=&nodep&claimed&min1&open&okrug=` (`tab`: `optimal`, `cheapest`, `nearest`, `okrug`) |
| `/{city}/{prokat или arenda}-{model}` | **страница модели** (`/krasnodar/prokat-karcher-puzzi-8-1`), те же параметры |
| `/{city}/poisk?q=` | разбор текста: редирект на модель, бренд или класс; чипы при неоднозначности; «не нашли» (noindex) |
| `/{city}/{category}` | все группы категории |
| `/{city}/prokaty`, `/{city}/prokaty/{shop}` | прокаты города, страница проката |
| `/kak-schitaem-ceny`, `/dlya-prokatov` | методика (итог, дорога, вкладки, источники данных); лендинг и заявка для прокатов |
| `/moy-prokat` | кабинет проката: цены, место, обращения |
| `/login`, `/welcome`, `/reset`, `/banned`, `/profile` | вход, онбординг, сброс пароля, профиль |
| `/admin/{shops,regular,leads}` | заявки на карточки, заявки «регулярно» и «не нашли», сводка обращений |
| `/admin/{users,cities,categories}` | пользователи, справочники |
| `/api/{auth,oauth/vk,upload,health}`, `/api/geo/{suggest,resolve}` | системные и геокодер; `/api/dev/login[?role=admin]` — dev-вход (404 в prod) |

Резолвер `/{city}/{seg}`: `prokaty` → `poisk` → группа → модель → категория сравнения →
(с P2P) категория объявлений. `/{city}/{seg}/{sub}`: `prokaty/{shop}` → (с P2P)
подкатегория или карточка товара.

## Карта кода

- **`drizzle/`** — `schema.ts` (источник схемы) + `migrations/`. Менять схему → `db:generate`.
- **`scripts/`** — `seed.ts` (+ `seed-demo-offers.ts`), `migrate.ts`, `sync-catalog.ts`, `import-offers.ts`. Последние три в Docker собираются в `*.cjs` (в runner нет pnpm/tsx), `sync-catalog.cjs` запускается в `entrypoint.sh`.
- **`src/lib/compare/`** — ядро сравнения, чистые функции: `config` (параметры ТЗ, п. 10), `pricing` (итог), `ranking` (расстояние, оценка, вкладки, доминирование, пояснение), `view` (модель выдачи, фильтры, тексты карточки, место в сравнении), `scenario` (параметры URL), `search` (подсказки и разбор запроса), `geo` + `geo-data` + `okrug-bounds` (места, расстояния, «Где»), `models` + `models-data` (бренды, модели, `modelKey`), `hours`, `calendar`, `faq`, `format`, `catalog-data`, `offers-csv`, `visitor` (cookies посетителя).
- **`src/server/compare.ts`, `src/server/shops.ts`** — read-слой сравнения и прокатов (предложения группы и модели с местом и моделью, `getCityGeo`, `getSearchData`, `getModelBySeg`); **`src/server/compare/`** — синхронизация справочников и импорт CSV; **`src/server/geocoder.ts`** — Яндекс Геокодер и Геосаджест (кэш; без ключа — выключен).
- **`src/server/actions/leads.ts`** — «Показать телефон», «Цена устарела?», «Нужен регулярно», «Не нашли», `claim_click`; **`actions/shops.ts`** — заявка на карточку, цены владельца, модерация.
- **`src/components/compare/`** — `ResultRoutes` (страницы группы, модели, поиска) → `ComparePage` (`ResultPage`), `SearchBar` (`WhatField`, `DateRangeField`, `WhereField`), `ResultTabs`, `OfferTicket`, `FiltersPanel`/`FiltersSheet`, `SavingsHint`, `OutOfRanking`, `NotFoundRequestForm`, `CityHome`, `CategoryPage`, `GroupCard` (+ `ModelCard`), `ShopPage`, `ShopsList`, `ShopClaimForm`…; **`src/components/shop/`** — формы кабинета проката.
- **`src/server/*.ts`, `src/server/actions/*.ts`** (прочее) — P2P и общее: `catalog.ts`, `owner.ts`, `booking.ts`, `me.ts`, `admin.ts`, `profile.ts`.
- **`src/lib/`** — `auth/`, `mail/`, `http/`, `catalog/` (P2P + общие `dates`), `features.ts`, `analytics.ts`, `rate-limit.ts`, `jsonld.ts`, `db.ts`, `id.ts`.
- **`src/components/`** (прочее) — `layout/` (шапка-полоса бренда, подвал), `brand/` (знак «inrenta.», скобки-лоадер), `ui/` (`Modal` — лист снизу на телефоне), `auth/`, `admin/`, `account/`, `seo/`; P2P — `catalog/`, `booking/`, `cabinet/`, `home/`.
- **`theme/`** — `tokens.css`, `tokens.schema.md` (контракт), `fonts.ts`, `typography.css`, `content.ts` (тексты), `seo.ts`.
- **`tests/`** — Vitest, зеркалит `src`; сравнение — `tests/compare/` (критерии приёмки ТЗ — в `search`, `pricing`, `view`, `geo`).

## Ключевые флоу

- **Сравнение:** главная → `SearchBar` «Что · Когда · Где» (поля пустые; подсказка — сразу цель, текст — через `/poisk`) → страница группы или модели → сервер считает `buildResultView` (итог, дорога, вкладки, фильтры) → карточки. Всё — SSR, ссылка открывает ту же выдачу в том же порядке.
- **Обращение:** лимиты обращений и форм — по сессии и по IP (`withinLimit`: cookie подделывается). «Показать телефон» → `revealShopPhone` пишет `lead_events.show_phone` (вкладка, место в выдаче, модель, сутки и тип места пользователя, UTM) и только тогда отдаёт номер и Telegram; параллельно цель Метрики. Телефонов в HTML нет. Пустая выдача → «найдём за 30 минут» → `regular_requests` (`kind=not_found`) + событие `request`.
- **Цены на старте:** CSV → `db:import-offers` (в проде — `docker compose exec app node import-offers.cjs`). У каждой цены дата проверки.
- **Подтверждение проката:** «Это ваш прокат?» (`claim_click`) → `/dlya-prokatov` → вход → заявка (`shop_claims`) → админ звонит на номер проката и одобряет в `/admin/shops` → `rental_shops.status=claimed`, `ownerUserId` → «Мой прокат» в меню → `/moy-prokat`: сохранение цен ставит `verifiedAt=сегодня`, `verifiedBy=shop`, бейдж «Подтвердил цены».
- **Auth:** VK ID, Яндекс ID или почта с паролем → новый юзер выбирает `username` на `/welcome`. Регистрация по почте: письмо (24 ч) → `emailVerified` → сессия. Сброс пароля (1 ч) удаляет все сессии. Автосклейки с OAuth нет (дискриминатор — строки в `accounts`).

## Конвенции

- **Темы и адаптив обязательны на каждом экране.** Цвета — только через токены `theme/tokens.css` (`:root` + `.dark`), не хардкодить. Мобайл проектируется первым классом, без горизонтального скролла body; кнопки ≥44px.
- **Закон цвета (вариант Б):** оранжевый (`cta`, `Button variant="cta"`) — **только** главная кнопка экрана и победитель вкладки; тёмно-зелёный бренд (`primary`, `header`) — шапка, выбранная вкладка, вторичные кнопки; ссылки и статусы — зелёный (`accent`, `ok`); предупреждения — `warn`. Шрифты: Unbounded — знак, H1, цены (класс `.price`); Onest — остальное.
- **Тексты** — по разделу «Тексты» `DESIGN_SYSTEM.md`: со стороны пользователя, нейтрально («на 700 ₽ дешевле самого дорогого», не «переплата»). Запрещены P2P-формулировки («аренда у соседей», «берите у людей рядом»).
- **Чужие фото и тексты прокатов не копируем** — только цены и условия; вместо фото — пиктограммы групп.
- **Тесты** — только в `tests/**`, импорт через `@/`.
- **Коммиты** — чистые и осмысленные, без нарратива задач/планов в теле; идентификаторы и сообщения на английском.

## Dev-заметки

- Поднять окружение: `docker compose up -d db` → `pnpm db:migrate && pnpm db:seed` → `pnpm dev`. Расстояния по дорогам: `bash scripts/osrm/prepare.sh` → `docker compose up -d osrm` → `OSRM_URL=http://127.0.0.1:5001` в `.env`. Геокодер (адреса в «Где» и при импорте) — `YANDEX_GEOCODER_API_KEY` и `YANDEX_SUGGEST_API_KEY` в `.env`; без них работают микрорайоны, округа и геолокация.
- Сброс dev-БД начисто: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` + `DROP SCHEMA IF EXISTS drizzle CASCADE;` (журнал миграций живёт в схеме `drizzle`).
- `.next/types` держит устаревшие типы удалённых роутов после dev-сервера → ложные `TS2307`; лечит `rm -rf .next/types`.
- Перед `pnpm build` останавливать dev-сервер (общий каталог `.next`). Production-сборке нужны `DOMAIN`, `LETSENCRYPT_EMAIL`, `STORAGE_*` (env-валидация).
- Seed создаёт: справочники (Краснодар; «Инструменты» — 9 групп, «Уборка» — 2, «Электровелосипеды» — 5 моделей; 4 округа и 30 микрорайонов; 12 брендов, 21 модель), вне production — 9 демо-прокатов и 26 предложений (вымышленные: адреса с координатами и без, прокат без местоположения, часы работы, Karcher Puzzi в разных написаниях, предложения без модели, одна цена старше 30 дней), и P2P-демо: 5 владельцев, 20 товаров.
- Вне production seed раздаёт `ownerN@seed.local` пароль `prokat-dev-12345` и проставляет `emailVerified`. Без `SMTP_*` письма печатаются в консоль dev-сервера.
- Проверить кабинет проката: `/api/dev/login` → заявка на `/dlya-prokatov` → `/api/dev/login?role=admin` → одобрить в `/admin/shops` → снова `/api/dev/login` → `/moy-prokat`.

## P2P-контур (за флагом)

Плоская модель **`users → listings → booking_requests`** (+ `availability`, `events`,
`uploads`). Товар принадлежит юзеру; заявка на бронь `new` → владелец подтверждает →
`confirmed` транзакционно увеличивает `bookedQty` с перепроверкой занятости под
блокировкой. Инварианты — `src/lib/catalog/booking-status.ts`, `availability.ts`:
диапазон брони включает обе границы; свободно = `quantity − bookedQty − blockedQty`
(нет строки — день свободен); только `confirmed` держит `bookedQty`, отмена
`confirmed` освобождает; заявки `new` протухают лениво по `expiresAt` (+24ч).
Маршруты: карточка товара `/{city}/{category}/{slug}-{id}` (ULID в хвосте, 301 на
канонический адрес), `/u/{username}`, `/search`, `/requests`, `/cabinet/*`.
