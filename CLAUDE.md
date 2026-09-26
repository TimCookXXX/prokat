# inrenta — сравнение цен прокатов

inrenta — не маркетплейс, а сравнение: собираем цены и условия прокатов города и
показываем **итоговую сумму за даты пользователя** у каждого проката (аренда с
минимальным сроком и недельным тарифом + доставка; залог — отдельно). Мы ничего не
сдаём, не берём оплату и не держим залоги: человек звонит прокату напрямую. Деньги —
позже, с прокатов за обращения клиентов. Старт — Краснодар и инструмент (плюс модели
электровелосипедов для курьеров), но категории и классы — **данные, а не код**: модель
должна принимать любые новые категории.

Спецификация продукта — `docs/inrenta-pivot/` (`PRODUCT.md`, `MIGRATION.md` — план по
шагам, `DATA_MODEL.md`, `DESIGN_SYSTEM.md`, макеты `mockups/*B.dc.html`). Файлы `docs/`
в сборку и `tsc` не входят — это эталон, рабочие копии живут в `src/`.

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
- **Тесты:** Vitest (432 теста, только в `tests/**`, импорт через `@/`).
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

Цепочка: **`categories → item_groups → item_classes ← offers → rental_shops → cities`**.

| Таблица | Назначение | Ключевое |
|---|---|---|
| **item_groups** | страница сравнения `/{city}/{slug}` (`prokat-perforatora`) | `categoryId`, `slug` (uniq, делит сегмент с категориями), `nameGenitive` (для H1), `seoWord` (`prokat`/`arenda`), `guide`, `searchKeywords` (синонимы для поиска: «болгарка», «отбойник») |
| **item_classes** | единица сравнения — внутри класса ранжируются предложения | `groupId`, `slug` (uniq глобально, по нему ищет CSV-импорт), `shortHint` |
| **rental_shops** | прокат; существует без владельца | `cityId`, `slug` (uniq в городе), контакты (телефон — только по клику), `sourceUrls`, `status` (`unclaimed`/`claimed`/`hidden`), `ownerUserId` (после подтверждения) |
| **offers** | цена и условия проката по классу | uniq (`shopId`,`itemClassId`,`model`) NULLS NOT DISTINCT; `priceDay` (NULL = только понедельно) / `priceWeek` — хотя бы одна (CHECK), `minDays`, `depositRub` (**NULL = «уточняется», 0 = без денежного**), доставка, `verifiedAt` (date) + `verifiedBy` (`call`/`site`/`listing`/`shop`) |
| **lead_events** | обращения: `show_phone`, `price_outdated`, `regular_request`, `claim_click`… | `offerId`, `shopId`, `itemClassId`, `sessionId` (cookie `inr_sid`), `tab`, `rankPosition`, `scenario`, `utm` (cookie `inr_utm`) |
| **regular_requests** | заявки «берём регулярно» | `cityId`, `what`, `frequency`, `contact`, `status` (`new`/`sent`/`closed`) |
| **shop_claims** | заявки «Это мой прокат» | `shopId` (NULL — проката нет в базе, тогда `shopName`), `userId`, `phone`, `status` (`new`/`approved`/`rejected`) |

- Справочник групп и классов — **код**: `src/lib/compare/catalog-data.ts`; `syncCatalog()` делает upsert по slug. Города и категории правятся в админке — синхронизация их только создаёт. Новая категория/класс = данные в этом файле. Слаг `prokaty` зарезервирован (список прокатов).
- Прокаты и цены заводятся CSV-импортом (`src/lib/compare/offers-csv.ts` → `src/server/compare/import-offers.ts`): файл целиком или ничего; строки-примеры шаблона отклоняются; более старая `verifiedAt` не затирает свежую.
- `cities.namePrepositional` — «в Краснодаре» для заголовков.

### Расчёт итога (`src/lib/compare/pricing.ts`)

- Итог считается **только** здесь и никогда не хранится.
- Срок пользователь задаёт **датами** («когда») во всех категориях, отдельных селекторов «неделя/месяц» нет. Сутки = `rentalDays(from, to)` (сб 27 → пн 29 = 2), минимум 1. Календарь — свой (`DateRangeField`, сетка и подсветка — `src/lib/compare/calendar.ts`): первый клик подсвечивается сразу, под курсором виден будущий период, второй клик в любую сторону закрывает (`pickRangeDay`); на компьютере два месяца, на телефоне один.
- Района доставки («куда привезти») нет: доставка у проката одна цена на город. Фильтр «Район проката» (`area`) — по районам самих прокатов из CSV.
- Оплачиваемый срок = max(сутки, `minDays`); без `priceDay` — округляется вверх до целых недель. Недельный тариф: недели × `priceWeek` + min(остаток × `priceDay`, `priceWeek`). Месячного тарифа нет.
- Цена старше 30 дней → блок «на перепроверке», никогда не побеждает во вкладке и не даёт цену «от». Нужна доставка, а её нет → блок «только самовывоз».
- Модель выдачи (вкладки, цены у фильтров, подсказка про неделю, место в сравнении) — `src/lib/compare/view.ts`; параметры URL — `scenario.ts`; «сегодня» — `localToday()` (московское время).

### Поиск «Что нужно» (`src/lib/compare/search.ts`)

- Строка с подсказками по мере набора (`WhatField`), без выпадающего списка всего каталога. Индекс строится на сервере из каталога города (`getCompareCatalog` + `getSearchModels` → `toSearchData`) и ищется на клиенте.
- Подсказки: группа, класс (если в группе их больше одного), бренд (≥2 моделей бренда в классе — «Перфоратор SDS-plus Makita»), модель. Бренд — первое слово `offers.model`.
- Каждое слово запроса — префикс слова подсказки (И по всем словам): «перфо maki» → Makita среди перфораторов. Прощает раскладку, транслит, одну опечатку; русские написания брендов — `BRAND_ALIASES`. Хоть одно слово должно попасть в саму подсказку, иначе «перфо» вывело бы все модели.
- Синонимы групп — `keywords` в `catalog-data.ts` → `item_groups.search_keywords`.
- Выбор бренда или модели ставит `m`: выдача (включая блоки вне рейтинга и цены у фильтров) — только эти модели; плашка «Показаны только … ✕» снимает фильтр, смена класса его сбрасывает.

## URL-структура

| URL | Что |
|---|---|
| `/`, `/{city}` | главная сравнения (город по умолчанию — `krasnodar`): поиск «что · когда», группы с ценой «от» |
| `/{city}/{group}` | **страница сравнения**: `?c=класс&m=модель|бренд&from&to&pickup=1&tab&nodep&today&claimed&min1&area=` |
| `/{city}/{category}` | все группы категории («Весь инструмент») |
| `/{city}/prokaty`, `/{city}/prokaty/{shop}` | прокаты города, страница проката (цены, место в сравнении, «Это ваш прокат?») |
| `/kak-schitaem-ceny`, `/dlya-prokatov` | методика; лендинг и заявка для прокатов |
| `/moy-prokat` | кабинет проката (владелец подтверждённой карточки): цены, место, обращения за месяц |
| `/login`, `/welcome`, `/reset`, `/banned`, `/profile` | вход/онбординг/сброс пароля/профиль |
| `/admin/{shops,regular,leads}` | заявки на карточки и прокаты, «нужен регулярно», сводка обращений |
| `/admin/{users,cities,categories}` | пользователи, справочники |
| `/api/{auth,oauth/vk,upload,health}` | системные; `/api/dev/login[?role=admin]` — dev-вход (404 в prod) |

Резолвер `/{city}/{seg}`: группа сравнения → категория сравнения → (с P2P) категория
объявлений. `/{city}/{seg}/{sub}`: `prokaty/{shop}` → (с P2P) подкатегория или карточка товара.

## Карта кода

- **`drizzle/`** — `schema.ts` (источник схемы) + `migrations/`. Менять схему → `db:generate`.
- **`scripts/`** — `seed.ts` (+ `seed-demo-offers.ts`), `migrate.ts`, `sync-catalog.ts`, `import-offers.ts`. Последние три в Docker собираются в `*.cjs` (в runner нет pnpm/tsx), `sync-catalog.cjs` запускается в `entrypoint.sh`.
- **`src/lib/compare/`** — ядро сравнения, чистые функции: `pricing` (итог, ранжирование, вкладки), `view` (модель выдачи, тексты билета, место в сравнении), `scenario` (параметры URL), `search` (подсказки поиска), `faq`, `format` (даты «27 сен», телефоны, склонения), `catalog-data`, `offers-csv`, `visitor` (cookies посетителя).
- **`src/server/compare.ts`, `src/server/shops.ts`** — read-слой сравнения и прокатов; **`src/server/compare/`** — синхронизация справочника и импорт CSV.
- **`src/server/actions/leads.ts`** — «Показать телефон», «Цена устарела?», «Нужен регулярно», `claim_click`; **`actions/shops.ts`** — заявка на карточку, цены владельца, модерация.
- **`src/components/compare/`** — `ComparePage`, `SearchBar`, `WhatField`, `DateRangeField`, `ResultTabs`, `OfferTicket`, `FiltersPanel`/`FiltersSheet`, `SavingsHint`, `OutOfRanking`, `CityHome`, `CategoryPage`, `GroupCard`, `ShopPage`, `ShopsList`, `ShopClaimForm`…; **`src/components/shop/`** — формы кабинета проката.
- **`src/server/*.ts`, `src/server/actions/*.ts`** (прочее) — P2P и общее: `catalog.ts`, `owner.ts`, `booking.ts`, `me.ts`, `admin.ts`, `profile.ts`.
- **`src/lib/`** — `auth/`, `mail/`, `http/`, `catalog/` (P2P + общие `dates`), `features.ts`, `analytics.ts`, `rate-limit.ts`, `jsonld.ts`, `db.ts`, `id.ts`.
- **`src/components/`** (прочее) — `layout/` (шапка-полоса бренда, подвал), `brand/` (знак «inrenta.», скобки-лоадер), `ui/` (`Modal` — лист снизу на телефоне), `auth/`, `admin/`, `account/`, `seo/`; P2P — `catalog/`, `booking/`, `cabinet/`, `home/`.
- **`theme/`** — `tokens.css`, `tokens.schema.md` (контракт), `fonts.ts`, `typography.css`, `content.ts` (тексты), `seo.ts`.
- **`tests/`** — Vitest, зеркалит `src`; сравнение — `tests/compare/`.

## Ключевые флоу

- **Сравнение:** главная → `SearchBar` (только «что нужно» с подсказками и «когда»; поля пустые, даты не выбраны — завтра на 1 сутки; «заберу сам» и залог — фильтры страницы сравнения) → `/{city}/{group}?…` → сервер считает `buildCompareView` → вкладки, фильтры (сразу меняют URL), «билеты». Всё — SSR, ссылка открывает ту же выдачу.
- **Обращение:** «Показать телефон» → `revealShopPhone` пишет `lead_events.show_phone` (вкладка, место, сценарий, UTM) и только тогда отдаёт номер; параллельно цель Метрики. Телефонов в HTML нет.
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

- Поднять окружение: `docker compose up -d db` → `pnpm db:migrate && pnpm db:seed` → `pnpm dev`.
- Сброс dev-БД начисто: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` + `DROP SCHEMA IF EXISTS drizzle CASCADE;` (журнал миграций живёт в схеме `drizzle`).
- `.next/types` держит устаревшие типы удалённых роутов после dev-сервера → ложные `TS2307`; лечит `rm -rf .next/types`.
- Перед `pnpm build` останавливать dev-сервер (общий каталог `.next`). Production-сборке нужны `DOMAIN`, `LETSENCRYPT_EMAIL`, `STORAGE_*` (env-валидация).
- Seed создаёт: справочник сравнения (Краснодар, «Инструменты» — 10 групп, «Электровелосипеды» — 5 моделей), вне production — 8 демо-прокатов и 17 предложений (вымышленные, из макетов; одна цена старше 30 дней, один прокат только на самовывоз), и P2P-демо в Краснодаре: 5 владельцев, 20 товаров.
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
